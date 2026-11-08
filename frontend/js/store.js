const KEY = 'playerify.v1';

const DEFAULT_SETTINGS = {
  volume: 0.8,
  muted: false,
  crossfade: 4,
  autolevel: true,
  verifiedOnly: false,
  motion: 'auto',
  preset: 'smart',
  depth: 72,
  speed: 85,
  room: 26,
  engineVersion: 2,
  eq: [0, 0, 0, 0, 0, 0, 0],
  eqOn: true,
  repeat: 'off',
  shuffle: false,
};

export const ui = {
  route: { name: 'discover', params: {} },
  loading: false,
  error: null,
  data: null,
  query: '',
  tab: 'all',
  artistSort: 'plays',
  genreTime: 'week',
  inspectorTab: 'signal',
  inspectorOpen: false,
  cache: new Map(),
};

export const library = {
  likes: {},
  playlists: [],
  recent: [],
};

export const settings = { ...DEFAULT_SETTINGS, eq: [...DEFAULT_SETTINGS.eq] };

export const playback = {
  queue: [],
  index: -1,
  current: null,
  playing: false,
  position: 0,
  duration: 0,
  buffered: 0,
  shuffle: false,
  repeat: 'off',
  loading: false,
};

let saveTimer = 0;

function readSaved() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function hydrate() {
  const saved = readSaved();
  if (saved.settings && typeof saved.settings === 'object') {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      if (saved.settings[key] !== undefined) {
        settings[key] = saved.settings[key];
      }
    }
  }
  if (saved.settings && Number(saved.settings.engineVersion) !== 2) {
    settings.preset = 'smart';
    settings.depth = 72;
    settings.room = 26;
    settings.engineVersion = 2;
  }
  if (Array.isArray(settings.eq) && settings.eq.length === 7) {
    settings.eq = settings.eq.map((value) => Math.max(-9, Math.min(9, Number(value) || 0)));
  } else {
    settings.eq = [...DEFAULT_SETTINGS.eq];
  }
  if (saved.likes && typeof saved.likes === 'object') {
    library.likes = saved.likes;
  }
  if (Array.isArray(saved.playlists)) {
    library.playlists = saved.playlists.filter((item) => item && item.id && Array.isArray(item.tracks));
  }
  if (Array.isArray(saved.recent)) {
    library.recent = saved.recent.filter((item) => item && item.id).slice(0, 40);
  }
  return saved;
}

export function saveNow() {
  const payload = {
    settings,
    likes: library.likes,
    playlists: library.playlists,
    recent: library.recent.slice(0, 40),
    last: playback.current
    ? {
        track: playback.current,
        queue: playback.queue.slice(0, 60),
        index: playback.index,
        position: playback.position,
      }
    : null,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    /* kota dolmuş olabilir; sessiz geç */
  }
  try {
    fetch('/api/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: payload }),
    }).catch(() => {});
  } catch {
    /* durum senkronu başarısız */
  }
}

function mergeState(local, server) {
  const merged = { ...server };
  if (local.settings) merged.settings = local.settings;
  merged.likes = { ...(server.likes || {}), ...(local.likes || {}) };
  const playlists = new Map();
  for (const item of [...(server.playlists || []), ...(local.playlists || [])]) {
    if (item && item.id) playlists.set(item.id, item);
  }
  merged.playlists = [...playlists.values()];
  const recent = new Map();
  for (const item of [...(server.recent || []), ...(local.recent || [])]) {
    if (item && item.id) recent.set(item.id, item);
  }
  merged.recent = [...recent.values()]
    .sort((left, right) => (right.playedAt || 0) - (left.playedAt || 0))
    .slice(0, 40);
  merged.last = local.last || server.last || null;
  return merged;
}

export async function syncFromServer() {
  try {
    const response = await fetch('/api/state', { headers: { accept: 'application/json' } });
    if (!response.ok) return false;
    const body = await response.json();
    const server = body && body.value;
    let local = null;
    try {
      const raw = localStorage.getItem(KEY);
      local = raw ? JSON.parse(raw) : null;
    } catch {
      local = null;
    }
    if (!server && !local) return false;
    const merged = local && server ? mergeState(local, server) : server || local;
    localStorage.setItem(KEY, JSON.stringify(merged));
    if (local && server) {
      try {
        fetch('/api/state', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value: merged }),
        }).catch(() => {});
      } catch {
        /* birleşik durum gönderilemedi */
      }
    }
    return Boolean(server);
  } catch {
    return false;
  }
}

export function save() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveNow, 320);
}

const listeners = new Map();

export function on(topic, handler) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(handler);
  return () => listeners.get(topic)?.delete(handler);
}

export function emit(topic, detail) {
  const handlers = listeners.get(topic);
  if (!handlers) return;
  for (const handler of [...handlers]) {
    try {
      handler(detail);
    } catch (error) {
      console.error(error);
    }
  }
}

export function isLiked(id) {
  return Boolean(library.likes[id]);
}

export function toggleLike(track) {
  if (!track || !track.id) return false;
  if (library.likes[track.id]) {
    delete library.likes[track.id];
    save();
    emit('library');
    return false;
  }
  library.likes[track.id] = { ...track, likedAt: Date.now() };
  save();
  emit('library');
  return true;
}

export function pushRecent(track) {
  if (!track || !track.id) return;
  library.recent = [{ ...track, playedAt: Date.now() }, ...library.recent.filter((item) => item.id !== track.id)].slice(0, 40);
  save();
}

export function createPlaylist(name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  const playlist = {
    id: `p_${Date.now().toString(36)}`,
    name: clean.slice(0, 60),
    createdAt: Date.now(),
    tracks: [],
  };
  library.playlists.unshift(playlist);
  save();
  emit('library');
  return playlist;
}

export function addToPlaylist(playlistId, track) {
  const playlist = library.playlists.find((item) => item.id === playlistId);
  if (!playlist || !track) return false;
  if (playlist.tracks.some((item) => item.id === track.id)) return false;
  playlist.tracks.push(track);
  save();
  emit('library');
  return true;
}

export function removeFromPlaylist(playlistId, trackId) {
  const playlist = library.playlists.find((item) => item.id === playlistId);
  if (!playlist) return;
  playlist.tracks = playlist.tracks.filter((item) => item.id !== trackId);
  save();
  emit('library');
}

export function deletePlaylist(playlistId) {
  library.playlists = library.playlists.filter((item) => item.id !== playlistId);
  save();
  emit('library');
}

export function clearAllData() {
  library.likes = {};
  library.playlists = [];
  library.recent = [];
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    settings[key] = Array.isArray(DEFAULT_SETTINGS[key])
      ? [...DEFAULT_SETTINGS[key]]
      : DEFAULT_SETTINGS[key];
  }
  saveNow();
  emit('library');
  emit('settings');
}

export const defaults = { settings: DEFAULT_SETTINGS };
