import { api } from './api.js';
import { BANDS, PRESETS } from './audio.js';
import { OrbitView } from './orbit.js';
import { player } from './player.js';
import {
  addToPlaylist,
  clearAllData,
  createPlaylist,
  deletePlaylist,
  emit,
  hydrate,
  isLiked,
  library,
  on,
  playback,
  removeFromPlaylist,
  save,
  saveNow,
  settings,
  syncFromServer,
  toggleLike,
  ui,
} from './store.js';
import { closeModal, isModalOpen, openEmbed, openLinkDialog, openModal, toast } from './ui.js';
import { clamp, debounce, esc, fmtTime, genreLabel, icon, image, isUrlLike } from './util.js';
import * as V from './views.js';

const $ = (selector) => document.querySelector(selector);

const view = $('#main');
const viewTitle = $('#viewTitle');
const viewKicker = $('#viewKicker');
const inspector = $('#inspector');
const scrim = $('#scrim');
const seek = $('#seek');
const seekFill = $('#seekFill');
const seekBuffer = $('#seekBuffer');
const timeNow = $('#timeNow');
const timeTotal = $('#timeTotal');
const volume = $('#volume');
const muteBtn = $('#muteBtn');
const playBtn = $('#playBtn');
const shuffleBtn = $('#shuffleBtn');
const repeatBtn = $('#repeatBtn');
const nowArt = $('#nowArt');
const nowTitle = $('#nowTitle');
const nowArtist = $('#nowArtist');
const nowLike = $('#nowLike');
const focusMode = $('#focusMode');
const focusBg = $('#focusBg');
const focusArt = $('#focusArt');
const focusTitle = $('#focusTitle');
const focusArtist = $('#focusArtist');
const focusLike = $('#focusLike');
const orbitArt = $('#orbitArt');
const orbitTag = $('#orbitTag');
const presetReadout = $('#presetReadout');
const railPreset = $('#railPreset');
const depthInput = $('#depth');
const speedInput = $('#speed');
const roomInput = $('#room');
const depthOut = $('#depthOut');
const speedOut = $('#speedOut');
const roomOut = $('#roomOut');
const spaceReadout = $('#spaceReadout');
const meterL = $('#meterL');
const meterR = $('#meterR');
const meterDb = $('#meterDb');
const qualityBadge = $('#qualityBadge');
const queueList = $('#queueList');
const queueCount = $('#queueCount');
const infoPanel = $('#infoPanel');
const fileInput = $('#fileInput');
const toastRoot = $('#toastRoot');

const engine = player.engine;
const orbit = new OrbitView($('#orbitCanvas'));

let routeToken = 0;
let searchAbort = null;
let pendingSearchFocus = false;
let isSeeking = false;
let artToken = '';
let deleteArm = null;
let clearArm = 0;
let lastMeterPaint = 0;
let paletteEl = null;
let paletteItems = [];
let paletteIndex = 0;
let paletteRestore = null;

function paintRange(input) {
  if (!input) return;
  const min = Number(input.min || 0);
  const max = Number(input.max || 100);
  const value = Number(input.value);
  const percent = ((value - min) / (max - min || 1)) * 100;
  input.style.setProperty('--p', String(clamp(percent, 0, 100)));
}

function paintAllRanges() {
  document.querySelectorAll('input[type="range"]').forEach(paintRange);
}

function buildEq() {
  const bank = $('#eqBank');
  if (!bank) return;
  bank.innerHTML = BANDS.map(
    (frequency, index) => `<div class="eq__band">
      <input type="range" min="-9" max="9" step="1" value="${settings.eq[index] || 0}" data-eq="${index}" aria-label="${frequency} Hz bandı">
      <span class="eq__label">${frequency >= 1000 ? `${frequency / 1000}k` : frequency}</span>
    </div>`,
  ).join('');
  bank.querySelectorAll('input').forEach(paintRange);
}

function syncEqUI() {
  document.querySelectorAll('[data-eq]').forEach((input) => {
    input.value = String(settings.eq[Number(input.dataset.eq)] || 0);
    paintRange(input);
  });
}

function applyMotion() {
  document.documentElement.dataset.motion = settings.motion || 'auto';
}

function syncPresetUI() {
  const preset = PRESETS[settings.preset];
  const label = preset ? preset.label : 'Özel';
  presetReadout.textContent = label;
  railPreset.textContent = label;
  document.querySelectorAll('[data-act="preset"]').forEach((button) => {
    const active = button.dataset.preset === settings.preset;
    button.classList.toggle('is-on', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const smartLine = $('#smartLine');
  if (smartLine) {
    const info = engine.smartInfo || {};
    if (settings.preset === 'smart') {
      const bpm = info.bpm ? `${Math.round(info.bpm)} BPM · ` : '';
      const period = info.period ? `${info.period.toFixed(1)} sn/tur · ` : '';
      smartLine.textContent = `${bpm}${period}bas merkezde`;
    } else {
      smartLine.textContent = 'Bas merkezde · 140 Hz crossover';
    }
  }
}

function syncSpaceUI() {
  if (depthInput) {
    depthInput.value = String(settings.depth);
    depthOut.textContent = String(settings.depth);
    paintRange(depthInput);
  }
  if (speedInput) {
    speedInput.value = String(settings.speed);
    speedOut.textContent = (settings.speed / 1000).toFixed(3);
    paintRange(speedInput);
  }
  if (roomInput) {
    roomInput.value = String(settings.room);
    roomOut.textContent = String(settings.room);
    paintRange(roomInput);
  }
  spaceReadout.textContent = `${settings.depth} · ${(settings.speed / 1000).toFixed(3)} · ${settings.room}`;
}

function syncVolumeUI() {
  const percent = Math.round(settings.volume * 100);
  volume.value = String(percent);
  volume.title = `Ses: ${percent}%`;
  paintRange(volume);
  const volumeSetting = $('#volumeSetting');
  if (volumeSetting) {
    volumeSetting.value = String(percent);
    paintRange(volumeSetting);
  }
  muteBtn.classList.toggle('is-muted', settings.muted);
  const use = muteBtn.querySelector('use');
  if (use) use.setAttribute('href', settings.muted ? '#i-volume-x' : '#i-volume');
  muteBtn.setAttribute('aria-label', settings.muted ? 'Sesi aç' : 'Sesi kapat');
  const autolevelBox = $('#autolevel');
  if (autolevelBox) autolevelBox.checked = settings.autolevel;
  const autolevelSetting = $('#autolevelSetting');
  if (autolevelSetting) autolevelSetting.checked = settings.autolevel;
  const crossfade = $('#crossfade');
  if (crossfade) {
    crossfade.value = String(settings.crossfade);
    paintRange(crossfade);
    const out = $('#crossfadeOut');
    if (out) out.textContent = `${settings.crossfade} sn`;
  }
}

function syncVerifiedUI() {
  const chip = $('#verifiedChip');
  if (chip) {
    chip.classList.toggle('is-on', settings.verifiedOnly);
    chip.setAttribute('aria-pressed', String(settings.verifiedOnly));
  }
  const rail = $('#railVerified');
  if (rail) {
    rail.dataset.on = String(settings.verifiedOnly);
    const em = rail.querySelector('em');
    if (em) em.textContent = settings.verifiedOnly ? 'açık' : 'kapalı';
  }
  const box = $('#verifiedOnlySetting');
  if (box) box.checked = settings.verifiedOnly;
}

function syncLikes() {
  document.querySelectorAll('[data-act="toggle-like"][data-id]').forEach((button) => {
    const liked = isLiked(button.dataset.id);
    button.setAttribute('aria-pressed', String(liked));
    button.setAttribute('aria-label', liked ? 'Beğeniden çıkar' : 'Beğen');
  });
  if (playback.current) {
    const liked = isLiked(playback.current.id);
    nowLike.setAttribute('aria-pressed', String(liked));
    nowLike.setAttribute('aria-label', liked ? 'Beğeniden çıkar' : 'Beğen');
    nowLike.disabled = false;
  } else {
    nowLike.setAttribute('aria-pressed', 'false');
    nowLike.disabled = true;
  }
  if (focusLike) {
    const liked = Boolean(playback.current && isLiked(playback.current.id));
    focusLike.setAttribute('aria-pressed', String(liked));
    focusLike.classList.toggle('is-liked', liked);
    focusLike.disabled = !playback.current;
  }
}

function syncRepeatUI() {
  repeatBtn.dataset.repeat = playback.repeat;
  repeatBtn.setAttribute('aria-pressed', String(playback.repeat !== 'off'));
  repeatBtn.setAttribute(
    'aria-label',
    playback.repeat === 'off'
      ? 'Tekrar kapalı'
      : playback.repeat === 'all'
        ? 'Tüm kuyruk tekrarda'
        : 'Tek parça tekrarda',
  );
}

function syncPlaybackUI() {
  document.body.classList.toggle('is-playing', Boolean(playback.playing));
  playBtn.setAttribute('aria-label', playback.playing ? 'Duraklat' : 'Oynat');
  const shuffleOn = Boolean(playback.shuffle);
  shuffleBtn.setAttribute('aria-pressed', String(shuffleOn));
  syncRepeatUI();
  syncLikes();
  markActiveRows();
  if ('mediaSession' in navigator) {
    navigator.mediaSession.playbackState = playback.playing ? 'playing' : 'paused';
  }
}

function syncQueueInspector() {
  if (queueList) queueList.innerHTML = V.queueList();
  if (queueCount) queueCount.textContent = String(Math.max(0, playback.queue.length - 1));
  if (infoPanel) infoPanel.innerHTML = V.renderInfo(playback.current);
}

function setImage(element, url) {
  if (!element) return;
  const src = url ? api.img(url) : '';
  if (element.dataset.src === src) return;
  element.dataset.src = src;
  element.classList.remove('is-loaded');
  if (!src) {
    element.removeAttribute('src');
    return;
  }
  element.onload = () => element.classList.add('is-loaded');
  element.onerror = () => element.classList.remove('is-loaded');
  element.src = src;
}

function updateMediaSession(track) {
  if (!('mediaSession' in navigator)) return;
  if (!track) {
    navigator.mediaSession.metadata = null;
    return;
  }
  const artwork = [];
  if (track.art) {
    artwork.push({ src: api.img(track.art), sizes: '1000x1000', type: 'image/jpeg' });
  }
  if (track.artSm) {
    artwork.push({ src: api.img(track.artSm), sizes: '480x480', type: 'image/jpeg' });
  }
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist ? track.artist.name : '',
    album: track.genre || 'playerify',
    artwork,
  });
}

function syncTransport() {
  const track = playback.current;
  if (track) {
    nowTitle.textContent = track.title;
    nowArtist.textContent = track.artist ? track.artist.name : 'Bilinmeyen sanatçı';
    setImage(nowArt, track.artSm || track.art);
    setImage(orbitArt, track.art || track.artSm);
    if (focusTitle) focusTitle.textContent = track.title;
    if (focusArtist) {
      focusArtist.textContent = track.artist ? track.artist.name : 'Bilinmeyen sanatçı';
    }
    if (focusArt) setImage(focusArt, track.art || track.artSm);
    if (focusBg) setImage(focusBg, track.art || track.artSm);
    if (focusLike) {
      focusLike.disabled = false;
      focusLike.dataset.id = track.id;
    }
    document.title = `${track.title}${track.artist ? ` · ${track.artist.name}` : ''} — playerify`;
    if (qualityBadge) {
      qualityBadge.textContent = track.preview ? '30 SN' : 'HQ';
      qualityBadge.title = track.preview
        ? `${track.sourceLabel || 'Katalog'} resmi 30 saniyelik önizlemesi`
        : 'Audius kaynaklı yüksek bit hızlı akış. Zincir: 48 kHz float, HRTF, konvolüsyon, limiter.';
    }
    updateMediaSession(track);
  } else {
    nowTitle.textContent = 'Henüz bir parça yok';
    nowArtist.textContent = 'Katalogdan bir şey seç';
    setImage(nowArt, '');
    setImage(orbitArt, '');
    if (focusTitle) focusTitle.textContent = 'Bir parça seç';
    if (focusArtist) focusArtist.textContent = 'Katalogdan bir şey çal';
    if (focusArt) setImage(focusArt, '');
    if (focusBg) setImage(focusBg, '');
    if (focusLike) {
      focusLike.dataset.id = '';
      focusLike.disabled = true;
    }
    if (focusMode && !focusMode.hidden) toggleFocus(false);
    document.title = 'playerify — dinleme odası';
    updateMediaSession(null);
  }
  syncLikes();
  syncQueueInspector();
}

function markActiveRows() {
  const current = playback.current;
  document.querySelectorAll('.row[data-row-id]').forEach((row) => {
    row.classList.toggle('is-active', Boolean(current && row.dataset.rowId === current.id));
  });
}

function syncSettingsUI() {
  syncPresetUI();
  syncSpaceUI();
  syncVolumeUI();
  syncVerifiedUI();
  syncEqUI();
  syncRepeatUI();
  document.querySelectorAll('[data-act="set-motion"]').forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.motion === settings.motion));
  });
}

function tickTransport() {
  const deck = engine.decks[engine.active];
  const position =
    deck && Number.isFinite(deck.el.currentTime) ? deck.el.currentTime : playback.position || 0;
  const duration =
    deck && Number.isFinite(deck.el.duration) && deck.el.duration > 0
      ? deck.el.duration
      : playback.duration || (playback.current ? playback.current.duration : 0);
  playback.position = position;
  playback.duration = duration;
  playback.buffered = engine.getBuffered();

  const percent = duration > 0 ? clamp(position / duration, 0, 1) : 0;
  if (!isSeeking) {
    seekFill.style.transform = `scaleX(${percent})`;
    seek.value = String(Math.round(percent * 1000));
    timeNow.textContent = fmtTime(position);
  }
  seekBuffer.style.transform = `scaleX(${playback.buffered || 0})`;
  timeTotal.textContent = fmtTime(duration);

  if (duration > 0 && duration - position < 28) player.preloadNext();
  player.maybeAutoAdvance(position, duration);
}

function setTopbar(route, data = null) {
  const base = {
    discover: ['KATALOG', 'Keşfet'],
    search: ['ARA', 'Ara'],
    library: ['YEREL', 'Kitaplık'],
    liked: ['KOLEKSİYON', 'Beğenilenler'],
    queue: ['ÇALAR', 'Kuyruk'],
  };
  let kicker = 'ODA';
  let title = 'playerify';
  if (base[route.name]) {
    [kicker, title] = base[route.name];
  } else if (route.name === 'genre') {
    kicker = 'SAHNE';
    title = genreLabel((data && data.genre) || route.params.genre) || 'Sahne';
  } else if (route.name === 'artist') {
    kicker = 'SANATÇI';
    title = (data && data.artist && data.artist.name) || 'Sanatçı';
  } else if (route.name === 'playlist') {
    kicker = 'LİSTE';
    title = (data && data.playlist && data.playlist.name) || 'Liste';
  } else if (route.name === 'local') {
    kicker = 'LİSTE';
    title = (data && data.name) || 'Liste';
  }
  viewKicker.textContent = kicker;
  viewTitle.textContent = title;
  document.title =
    route.name === 'discover' ? 'playerify — dinleme odası' : `${title} — playerify`;
}

function markNav(name) {
  document.querySelectorAll('[data-nav]').forEach((element) => {
    const key = element.dataset.nav;
    const active = key === name || (name === 'local' && key === 'library');
    if (active) element.setAttribute('aria-current', 'page');
    else element.removeAttribute('aria-current');
  });
}

function afterRender() {
  markActiveRows();
  syncLikes();
  syncQueueInspector();
  if (!playback.current) {
    const preview =
      V.lists.featured[0] ||
      V.lists.trending[0] ||
      V.lists.monthly[0] ||
      V.lists.search[0] ||
      V.lists.genre[0] ||
      V.lists.playlist[0] ||
      V.lists.artist[0] ||
      null;
    if (preview) {
      setImage(orbitArt, preview.art || preview.artSm);
      applyArtColors(preview);
    }
  }
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean).map((part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  });
  const name = parts[0] || 'discover';
  if (name === 'artist') return { name, params: { id: parts[1] || '' } };
  if (name === 'playlist') return { name, params: { id: parts[1] || '' } };
  if (name === 'local') return { name, params: { id: parts[1] || '' } };
  if (name === 'genre') return { name, params: { genre: parts.slice(1).join('/') || 'Electronic' } };
  if (['discover', 'search', 'library', 'liked', 'queue'].includes(name)) {
    return { name, params: {} };
  }
  return { name: 'discover', params: {} };
}

async function fetchRemote(route) {
  const key = `${route.name}:${route.params.id || route.params.genre || ''}:${route.name === 'artist' ? ui.artistSort : ''}:${route.name === 'genre' ? ui.genreTime : ''}`;
  const cached = ui.cache.get(key);
  const ttl = route.name === 'discover' ? 300000 : 120000;
  if (cached && Date.now() - cached.at < ttl) return cached.data;
  let data;
  if (route.name === 'discover') data = await api.home();
  else if (route.name === 'genre') data = await api.discover(route.params.genre, ui.genreTime);
  else if (route.name === 'artist') data = await api.artist(route.params.id, ui.artistSort);
  else if (route.name === 'playlist') data = await api.playlist(route.params.id);
  else throw new Error('Bilinmeyen görünüm');
  ui.cache.set(key, { at: Date.now(), data });
  return data;
}

function renderRemote(route, data) {
  if (route.name === 'discover') view.innerHTML = V.renderHome(data);
  else if (route.name === 'genre') view.innerHTML = V.renderGenre(data, route.params.genre, ui.genreTime);
  else if (route.name === 'artist') view.innerHTML = V.renderArtist(data, ui.artistSort);
  else if (route.name === 'playlist') view.innerHTML = V.renderPlaylist(data);
}

async function route() {
  if (focusMode && !focusMode.hidden) toggleFocus(false);
  const parsed = parseHash();
  ui.route = parsed;
  markNav(parsed.name);

  if (parsed.name === 'search') {
    renderSearchScreen();
    return;
  }

  if (parsed.name === 'library') {
    setTopbar(parsed);
    view.innerHTML = V.renderLibrary();
    afterRender();
    view.focus({ preventScroll: true });
    return;
  }

  if (parsed.name === 'liked') {
    setTopbar(parsed);
    view.innerHTML = V.renderLiked();
    afterRender();
    view.focus({ preventScroll: true });
    return;
  }

  if (parsed.name === 'queue') {
    setTopbar(parsed);
    view.innerHTML = V.renderQueuePage();
    afterRender();
    view.focus({ preventScroll: true });
    return;
  }

  if (parsed.name === 'local') {
    const playlist = library.playlists.find((item) => item.id === parsed.params.id);
    setTopbar(parsed, playlist || null);
    view.innerHTML = playlist
      ? V.renderLocalPlaylist(playlist)
      : V.emptyState('Liste bulunamadı', 'Silinmiş olabilir ya da başka bir tarayıcıda kalmış olabilir.', 'Kitaplığa dön', 'go-library');
    afterRender();
    view.focus({ preventScroll: true });
    return;
  }

  const token = ++routeToken;
  setTopbar(parsed);
  view.innerHTML = parsed.name === 'discover' ? V.skeletonHome() : V.skeletonRows(10);
  try {
    const data = await fetchRemote(parsed);
    if (token !== routeToken) return;
    ui.data = data;
    renderRemote(parsed, data);
    setTopbar(parsed, data);
    afterRender();
    view.scrollTop = 0;
    view.focus({ preventScroll: true });
  } catch (error) {
    if (token !== routeToken) return;
    view.innerHTML = V.errorState(error.message || 'Katalog yanıt vermedi.');
  }
}

function linkHint(url) {
  return `<div class="searchlead">
    <h2 class="searchlead__title">Bağlantı yakalandı</h2>
    <p class="searchlead__sub">${esc(url)}</p>
    <div class="suggestions"><button class="chip is-on" data-act="resolve-inline" data-url="${esc(url)}">${icon('link')} Aç</button></div>
  </div>`;
}

async function runSearch(raw) {
  const results = $('#searchResults');
  if (!results) return;
  const query = String(raw ?? '').trim();
  ui.query = query;
  if (!query) {
    results.innerHTML = V.searchLead();
    return;
  }
  if (isUrlLike(query)) {
    results.innerHTML = linkHint(query);
    return;
  }

  if (searchAbort) searchAbort.abort();
  const controller = new AbortController();
  searchAbort = controller;
  results.innerHTML = V.skeletonRows(7);
  try {
    const data = await api.search(query, controller.signal);
    if (controller.signal.aborted) return;
    ui.searchData = data;
    ui.tab = 'all';
    results.innerHTML = V.searchResults(data);
    afterRender();
  } catch (error) {
    if (error.name === 'AbortError') return;
    results.innerHTML = V.errorState(error.message || 'Arama başarısız');
  }
}

const debouncedSearch = debounce(() => {
  const input = $('#searchInput');
  if (input) runSearch(input.value);
}, 340);

function onSearchKey(event) {
  const input = event.currentTarget;
  if (event.key === 'Enter') {
    event.preventDefault();
    const value = input.value.trim();
    if (isUrlLike(value)) resolveLink(value);
    else runSearch(value);
  } else if (event.key === 'Escape') {
    input.value = '';
    ui.query = '';
    const results = $('#searchResults');
    if (results) results.innerHTML = V.searchLead();
  }
}

function renderSearchScreen() {
  setTopbar({ name: 'search', params: {} });
  view.innerHTML = V.searchShell(ui.query);
  const input = $('#searchInput');
  if (input) {
    input.addEventListener('input', debouncedSearch);
    input.addEventListener('keydown', onSearchKey);
  }
  const results = $('#searchResults');
  if (ui.query) {
    if (input) input.value = ui.query;
    runSearch(ui.query);
  } else if (results) {
    results.innerHTML = V.searchLead();
  }
  if (pendingSearchFocus) {
    pendingSearchFocus = false;
    requestAnimationFrame(() => {
      const field = $('#searchInput');
      if (field) {
        field.focus();
        field.select();
      }
    });
  }
  view.focus({ preventScroll: true });
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function goSearch(query = '') {
  ui.query = query;
  if (ui.route.name === 'search') {
    const input = $('#searchInput');
    if (input) {
      input.value = query;
      input.focus();
      input.select();
    }
    runSearch(query);
    return;
  }
  pendingSearchFocus = true;
  go('#/search');
}

function openSearch() {
  if (ui.route.name === 'search') {
    const input = $('#searchInput');
    if (input) {
      input.focus();
      input.select();
      return;
    }
  }
  pendingSearchFocus = true;
  go('#/search');
}

async function pasteLink() {
  try {
    const text = await navigator.clipboard.readText();
    const clean = String(text || '').trim();
    if (clean && isUrlLike(clean)) {
      resolveLink(clean);
      return;
    }
    openLinkDialog(clean);
  } catch {
    openLinkDialog('');
  }
}

let lastLinkResult = null;
let pendingNearMatch = null;

function normalizeForMatch(value) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/ı/g, 'i')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function editDistance(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  let current = new Array(b.length + 1).fill(0);
  for (let row = 0; row < a.length; row += 1) {
    current[0] = row + 1;
    for (let column = 0; column < b.length; column += 1) {
      const cost = a[row] === b[column] ? 0 : 1;
      current[column + 1] = Math.min(
        previous[column + 1] + 1,
        current[column] + 1,
        previous[column] + cost,
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

function isAdjacentTransposition(left, right) {
  const a = Array.from(left);
  const b = Array.from(right);
  if (a.length !== b.length) return false;
  const differences = [];
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      differences.push(index);
      if (differences.length > 2) return false;
    }
  }
  return (
    differences.length === 2 &&
    differences[0] + 1 === differences[1] &&
    a[differences[0]] === b[differences[1]] &&
    a[differences[1]] === b[differences[0]]
  );
}

function tokenFuzzyMatch(token, words) {
  if (token.length < 4) return words.includes(token);
  const allowance = token.length <= 6 ? 1 : 2;
  return words.some(
    (word) =>
      (Math.abs(word.length - token.length) <= allowance &&
        editDistance(token, word) <= allowance) ||
      isAdjacentTransposition(token, word),
  );
}

function cleanLinkTitle(result) {
  return String((result && result.title) || '')
    .replace(/\s*[\[(](official|lyrics?|audio|video|music video|visualizer|remaster(ed)?|4k)[^\])]*[\])]/gi, '')
    .replace(/\b(official video|official music video|lyrics|audio|remastered|4k)\b/gi, '')
    .replace(/\s*-\s*Topic\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isStrongMatch(linkTitle, candidateTitle) {
  const left = normalizeForMatch(linkTitle);
  const right = normalizeForMatch(candidateTitle);
  if (!left || !right) return false;
  return left.includes(right) || right.includes(left);
}

function artistMatches(linkArtist, candidateArtist) {
  const left = normalizeForMatch(linkArtist).replace(/\s*-\s*topic$/, '');
  const right = normalizeForMatch(candidateArtist).replace(/\s*-\s*topic$/, '');
  if (!left || !right) return true;
  return left.includes(right) || right.includes(left);
}

async function findMatches(linkInfo) {
  const title = cleanLinkTitle(linkInfo);
  const artist = String(linkInfo.artist || '').trim();
  const query = [title, artist].filter(Boolean).join(' ').trim();
  if (!query) return null;
  try {
    const data = await api.search(query);
    const tracks = (data.tracks || []).filter(
      (track) => track.playable !== false && !track.preview,
    );
    const audius = tracks.filter((track) => track.source === 'audius');
    const youtube = tracks.filter((track) => track.source === 'youtube');
    const strong = (track) =>
      isStrongMatch(linkInfo.title, track.title) &&
      artistMatches(linkInfo.artist, track.artist ? track.artist.name : '');
    return {
      audius: audius.find(strong) || null,
      audiusList: audius,
      youtube: youtube.find(strong) || null,
      youtubeList: youtube,
      near: audius[0] || null,
    };
  } catch {
    return null;
  }
}

function youtubeLinkTrack(result) {
  return {
    id: `yt:${result.videoId}`,
    source: 'youtube',
    sourceLabel: 'YouTube',
    title: result.title || 'YouTube videosu',
    artist: { id: null, name: result.author || 'YouTube', verified: false, avatar: null },
    art: result.thumbnail || null,
    artSm: result.thumbnail || null,
    duration: 0,
    fullDuration: 0,
    genre: null,
    bpm: null,
    key: null,
    plays: 0,
    likes: 0,
    description: null,
    tags: null,
    released: null,
    permalink: null,
    verified: false,
    preview: false,
    playable: true,
    stream: null,
    external: result.url,
    album: null,
    explicit: false,
    popularity: 0,
    kind: 'youtube',
    videoId: result.videoId,
    author: result.author || '',
    embed: result.embed,
  };
}

let importState = null;

function importRowMarkup(track, index) {
  return `<li class="importrow" data-import-index="${index}" style="--i:${Math.min(index, 18)}">
    <span class="importrow__num">${String(index + 1).padStart(2, '0')}</span>
    <span class="importrow__meta">
      <span class="importrow__title">${esc(track.title)}</span>
      <span class="importrow__artist">${esc(track.artist || 'Bilinmeyen sanatçı')}</span>
      <span class="importrow__match" data-import-match hidden></span>
    </span>
    <span class="importrow__status" data-import-status><span class="importrow__spinner" aria-hidden="true"></span></span>
  </li>`;
}

function openImportModal(data) {
  importState = {
    data,
    matches: new Array(data.tracks.length).fill(null),
    matched: [],
    skipped: [],
    done: 0,
    playlistId: null,
    finished: false,
  };
  const rows = data.tracks.map((track, index) => importRowMarkup(track, index)).join('');
  openModal(
    `<div class="modal__head">
      <span class="modal__title">Spotify listesi aktarılıyor</span>
      <button class="iconbtn" data-act="close-overlay" aria-label="Kapat">${icon('x')}</button>
    </div>
    <div class="modal__body">
      <div class="importhead">
        ${data.art ? `<span class="importhead__art">${image(data.art, '', data.name)}</span>` : ''}
        <div class="importhead__meta">
          <div class="eyebrow">SPOTIFY ${data.spotifyType === 'album' ? 'ALBÜMÜ' : 'LİSTESİ'}</div>
          <div class="importhead__title">${esc(data.name)}</div>
          <div class="importhead__sub">${esc(data.subtitle || '')}${data.subtitle ? ' · ' : ''}${data.tracks.length} parça</div>
        </div>
      </div>
      <div class="importprogress"><i id="importBar"></i></div>
      <div class="importmeta">
        <span id="importCount">0 / ${data.tracks.length}</span>
        <span id="importStatus">YouTube eşleşmeleri aranıyor…</span>
      </div>
      <div class="importfilter">
        ${icon('search')}
        <input id="importSearch" type="search" placeholder="Listede ara: şarkı veya sanatçı" autocomplete="off" spellcheck="false" aria-label="Spotify listesinde ara">
        <span class="importfilter__count" id="importFilterCount">${data.tracks.length} / ${data.tracks.length}</span>
      </div>
      <ol class="importlist" id="importList">${rows}</ol>
      <div class="importsummary" id="importSummary" hidden></div>
      <div class="modal__foot" style="border:0;padding:14px 0 0;flex-wrap:wrap">
        <button class="btn btn--primary" data-act="import-play" disabled>${icon('play')} Çal</button>
        <button class="btn btn--glass" data-act="import-library" disabled>${icon('library')} Kitaplıkta aç</button>
        <a class="btn btn--ghost" href="${esc(data.url)}" target="_blank" rel="noopener noreferrer">${icon('external')} Spotify'da aç</a>
        <button class="btn btn--ghost" data-act="close-overlay">Kapat</button>
      </div>
    </div>`,
    { wide: true, label: 'Spotify listesi aktarılıyor' },
  );
  const search = document.getElementById('importSearch');
  if (search) {
    search.addEventListener('input', () => filterImportRows(search.value));
    requestAnimationFrame(() => search.focus());
  }
}

function filterImportRows(raw) {
  if (!importState) return;
  const query = normalizeForMatch(raw);
  const tokens = query ? query.split(/\s+/) : [];
  let visible = 0;
  document.querySelectorAll('.importrow').forEach((row) => {
    const title = row.querySelector('.importrow__title');
    const artist = row.querySelector('.importrow__artist');
    const haystack = normalizeForMatch(
      `${title ? title.textContent : ''} ${artist ? artist.textContent : ''}`,
    );
    const words = haystack.split(/\s+/).filter(Boolean);
    const show =
      !tokens.length ||
      tokens.every((token) => words.includes(token) || tokenFuzzyMatch(token, words));
    row.hidden = !show;
    if (show) visible += 1;
  });
  const count = document.getElementById('importFilterCount');
  if (count) {
    count.textContent = `${visible} / ${importState.data.tracks.length}`;
  }
}

function importRow(index) {
  return document.querySelector(`[data-import-index="${index}"]`);
}

function markImportMatched(index, track, confidence) {
  const row = importRow(index);
  if (!row) return;
  row.classList.add('is-matched');
  const status = row.querySelector('[data-import-status]');
  if (status) status.innerHTML = `<span class="importrow__check">${icon('check')}</span>`;
  const match = row.querySelector('[data-import-match]');
  if (match) {
    const guess = confidence === 'medium' ? '<em class="importrow__guess">tahmini</em>' : '';
    match.innerHTML = `${icon('spark')}<span>${esc(track.title)}</span>${guess}`;
    match.hidden = false;
  }
}

function markImportSkipped(index, reason) {
  const row = importRow(index);
  if (!row) return;
  row.classList.add('is-skipped');
  const status = row.querySelector('[data-import-status]');
  if (status) status.innerHTML = icon('x');
  const match = row.querySelector('[data-import-match]');
  if (match) {
    match.innerHTML = `<span>${esc(reason)}</span>`;
    match.hidden = false;
  }
}

function updateImportProgress() {
  if (!importState) return;
  const bar = document.getElementById('importBar');
  const count = document.getElementById('importCount');
  const status = document.getElementById('importStatus');
  if (!bar || !count) {
    importState = null;
    return;
  }
  const total = importState.data.tracks.length;
  const percent = total ? (importState.done / total) * 100 : 100;
  bar.style.width = `${percent.toFixed(1)}%`;
  count.textContent = `${importState.done} / ${total}`;
  if (status) {
    status.textContent =
      importState.done >= total ? 'Eşleştirme tamamlandı' : 'YouTube eşleşmeleri aranıyor…';
  }
}

function finishImport() {
  if (!importState || importState.finished) return;
  importState.finished = true;
  const summary = document.getElementById('importSummary');
  const playButton = document.querySelector('[data-act="import-play"]');
  const libraryButton = document.querySelector('[data-act="import-library"]');
  if (!summary) {
    importState = null;
    return;
  }
  const matched = [];
  const seen = new Set();
  for (const track of importState.matches) {
    if (track && !seen.has(track.id)) {
      seen.add(track.id);
      matched.push(track);
    }
  }
  importState.matched = matched;
  const skipped = importState.skipped;
  if (matched.length) {
    const playlist = createPlaylist(importState.data.name || 'Spotify listesi');
    if (playlist) {
      for (const track of matched) addToPlaylist(playlist.id, track);
      importState.playlistId = playlist.id;
    }
    summary.innerHTML = `<span class="importsummary__ok">${icon('check')} ${matched.length} parça eklendi</span>${
      skipped.length
        ? `<span class="importsummary__skip">${icon('x')} ${skipped.length} parça atlandı</span>`
        : ''
    }`;
    if (playButton) playButton.disabled = false;
    if (libraryButton) libraryButton.disabled = !importState.playlistId;
  } else {
    summary.innerHTML = `<span class="importsummary__skip">${icon('x')} Güvenilir eşleşme bulunamadı; hiçbir parça eklenmedi.</span>`;
  }
  summary.hidden = false;
  toast(
    matched.length
      ? `${matched.length} parça listeye eklendi${skipped.length ? `, ${skipped.length} atlandı` : ''}`
      : 'Güvenilir eşleşme bulunamadı',
    matched.length ? 'ok' : 'error',
  );
}

async function importSpotifyList(url) {
  toast('Spotify listesi alınıyor…');
  let data;
  try {
    data = await api.spotifyList(url);
  } catch (error) {
    toast(error.message || 'Spotify listesi alınamadı', 'error');
    return;
  }
  if (!data || !Array.isArray(data.tracks) || !data.tracks.length) {
    toast('Bu listede parça bulunamadı', 'error');
    return;
  }
  openImportModal(data);
  const state = importState;
  let cursor = 0;
  const worker = async () => {
    while (importState === state && cursor < data.tracks.length) {
      const index = cursor;
      cursor += 1;
      const track = data.tracks[index];
      let result = null;
      try {
        result = await api.youtubeMatch(track.title, track.artist, track.duration);
      } catch {
        result = null;
      }
      if (importState !== state) return;
      if (result && result.match && result.confidence !== 'none') {
        const source = data.tracks[index];
        state.matches[index] = {
          ...result.match,
          title: source.title,
          artist: {
            ...result.match.artist,
            name: source.artist || result.match.artist.name,
          },
          youtubeTitle: result.match.title,
          importConfidence: result.confidence,
        };
        markImportMatched(index, result.match, result.confidence);
      } else {
        const reason = (result && result.reason) || 'Eşleşme bulunamadı';
        state.skipped.push({ track, reason });
        markImportSkipped(index, reason);
      }
      state.done += 1;
      updateImportProgress();
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(3, data.tracks.length) }, () => worker()),
  );
  if (importState === state) finishImport();
}

function platformName(linkInfo) {
  if (linkInfo.kind === 'spotify') return 'Spotify';
  if (linkInfo.kind === 'youtube') return 'YouTube';
  return linkInfo.sourceLabel || 'Kaynak';
}

function linkCard(linkInfo, title, sub) {
  return `<div class="linkcard">
    ${linkInfo.thumbnail ? image(linkInfo.thumbnail, '', title) : '<span class="pcard__art" style="width:76px;height:76px"></span>'}
    <div class="linkcard__meta">
      <div class="linkcard__title">${esc(title)}</div>
      <div class="linkcard__sub">${esc(sub)}</div>
    </div>
  </div>`;
}

function openNearMatch(linkInfo, match) {
  pendingNearMatch = match;
  const platform = platformName(linkInfo);
  const candidate = match.track;
  openModal(
    `<div class="modal__head">
      <span class="modal__title">Birebir eşleşme yok</span>
      <button class="iconbtn" data-act="close-overlay" aria-label="Kapat">${icon('x')}</button>
    </div>
    <div class="modal__body">
      <div class="note">${icon('search')}<span>${esc(platform)} bağlantısı çözüldü. Audius'ta birebir aynı kayıt yok; en yakın tam kaydı aşağıda buldum.</span></div>
      ${linkCard(linkInfo, linkInfo.title, platform)}
      <div class="linkcard">
        ${image(candidate.art, '', candidate.title)}
        <div class="linkcard__meta">
          <div class="linkcard__title">${esc(candidate.title)}</div>
          <div class="linkcard__sub">${esc(candidate.artist ? candidate.artist.name : '')} · Audius · tam kayıt</div>
        </div>
      </div>
      <div class="modal__foot" style="border:0;padding:10px 0 0;flex-wrap:wrap">
        <button class="btn btn--primary" data-act="play-near">${icon('play')} Bu tam kaydı çal</button>
        <button class="btn btn--glass" data-act="open-files">${icon('disc')} Kendi dosyam</button>
        <button class="btn btn--ghost" data-act="close-overlay">Vazgeç</button>
      </div>
    </div>`,
    { label: 'Birebir eşleşme yok' },
  );
}

function openLinkFallback(linkInfo) {
  lastLinkResult = linkInfo;
  const platform = platformName(linkInfo);
  const canEmbed = Boolean(linkInfo.embed);
  openModal(
    `<div class="modal__head">
      <span class="modal__title">Tam sürüm bulunamadı</span>
      <button class="iconbtn" data-act="close-overlay" aria-label="Kapat">${icon('x')}</button>
    </div>
    <div class="modal__body">
      ${linkCard(linkInfo, linkInfo.title, platform)}
      <div class="note">${icon('spark')}<span>${esc(platform)} ham sesi paylaşmıyor. Audius'ta bu kaydın tam sürümünü bulamadım. 30 saniyelik önizleme artık çalınmıyor. Kendi dosyanı açarsan tam kalitede, 8D zinciriyle çalar.</span></div>
      <div class="modal__foot" style="border:0;padding:12px 0 0;flex-wrap:wrap">
        <button class="btn btn--primary" data-act="open-files">${icon('disc')} Dosya aç</button>
        ${linkInfo.url ? `<a class="btn btn--glass" href="${esc(linkInfo.url)}" target="_blank" rel="noopener noreferrer">${icon('external')} ${platform}'da aç</a>` : ''}
        ${canEmbed ? `<button class="btn btn--ghost" data-act="open-embedded">${icon('external')} Gömülü oynatıcıyı aç</button>` : ''}
        <button class="btn btn--ghost" data-act="close-overlay">Kapat</button>
      </div>
    </div>`,
    { label: 'Tam sürüm bulunamadı' },
  );
}

async function resolveLink(raw) {
  const query = String(raw || '').trim();
  if (!query) return;
  toast('Bağlantı çözümleniyor…');
  try {
    const result = await api.resolve(query);
    if (result.kind === 'audius' && result.track) {
      closeModal();
      player.play(result.track, { queue: [result.track], index: 0 });
      toast('Audius tam kaydı açıldı');
      return;
    }

    if (result.kind === 'youtube' && result.videoId) {
      closeModal();
      player.play(youtubeLinkTrack(result));
      return;
    }

    if (result.kind === 'youtube_playlist') {
      closeModal();
      openEmbed(result);
      return;
    }

    if (
      result.kind === 'spotify' &&
      (result.spotifyType === 'playlist' || result.spotifyType === 'album')
    ) {
      closeModal();
      importSpotifyList(query);
      return;
    }

    if (result.kind === 'spotify') {
      closeModal();
      openEmbed(result);
      return;
    }

    let linkInfo = null;
    if ((result.kind === 'itunes' || result.kind === 'deezer') && result.track) {
      linkInfo = {
        kind: 'external',
        title: result.track.title,
        artist: (result.track.artist && result.track.artist.name) || '',
        thumbnail: result.track.art,
        url: result.track.external,
        sourceLabel: result.track.sourceLabel || (result.kind === 'itunes' ? 'Apple Music' : 'Deezer'),
      };
    } else if (result.kind === 'spotify') {
      linkInfo = {
        kind: 'spotify',
        title: result.title || query,
        artist: result.artist || '',
        thumbnail: result.thumbnail,
        url: result.url,
        embed: result.embed,
      };
    } else if (result.kind === 'search') {
      closeModal();
      goSearch(result.query || query);
      return;
    }
    if (!linkInfo) {
      closeModal();
      goSearch(query);
      return;
    }

    const matches = await findMatches(linkInfo);
    if (matches && matches.audius) {
      closeModal();
      const index = matches.audiusList.findIndex((track) => track.id === matches.audius.id);
      player.play(matches.audius, { queue: matches.audiusList, index: Math.max(0, index) });
      toast('Aynı şarkının Audius tam kaydı açıldı');
      return;
    }
    if (matches && matches.youtube) {
      closeModal();
      const index = matches.youtubeList.findIndex((track) => track.id === matches.youtube.id);
      player.play(matches.youtube, {
        queue: matches.youtubeList,
        index: Math.max(0, index),
      });
      toast('YouTube kaydı Playerify çalarında açıldı');
      return;
    }
    if (linkInfo.embed) {
      closeModal();
      openEmbed(linkInfo);
      toast('Gömülü oynatıcıda açıldı');
      return;
    }
    if (matches && matches.near) {
      const index = matches.audiusList.findIndex((track) => track.id === matches.near.id);
      openNearMatch(linkInfo, {
        track: matches.near,
        queue: matches.audiusList,
        index: Math.max(0, index),
      });
      return;
    }
    openLinkFallback(linkInfo);
  } catch (error) {
    toast(error.message || 'Bağlantı çözümlenemedi', 'error');
    openLinkDialog(query);
  }
}

function handleFiles(fileList) {
  const files = [...(fileList || [])].filter(
    (file) =>
      file &&
      (String(file.type).startsWith('audio/') ||
        /\.(mp3|m4a|aac|wav|flac|ogg|opus|webm)$/i.test(file.name)),
  );
  if (!files.length) {
    toast('Ses dosyası bulunamadı', 'error');
    return;
  }
  const tracks = files.map((file) => {
    const title = file.name.replace(/\.[^.]+$/, '');
    return {
      id: `local:${file.name}:${file.size}:${file.lastModified}`,
      source: 'local',
      sourceLabel: 'Yerel',
      title,
      artist: { id: null, name: 'Yerel dosya', verified: false, avatar: null },
      art: null,
      artSm: null,
      duration: 0,
      fullDuration: 0,
      genre: null,
      bpm: null,
      key: null,
      plays: 0,
      likes: 0,
      description: null,
      tags: null,
      released: null,
      permalink: null,
      verified: false,
      preview: false,
      playable: true,
      stream: URL.createObjectURL(file),
      external: null,
      album: 'Yerel dosya',
      explicit: false,
      popularity: 0,
    };
  });
  closeModal();
  player.play(tracks[0], { queue: tracks, index: 0 });
  toast(`${tracks.length} dosya tam kalitede çalma sırasına alındı`);
}

function applyPreset(name) {
  const preset = player.setPreset(name);
  syncSettingsUI();
  toast(name === 'off' ? 'Motor kapalı' : `${preset.label} motoru açık`);
}

function toggleInspector(force) {
  const open = typeof force === 'boolean' ? force : !ui.inspectorOpen;
  ui.inspectorOpen = open;
  inspector.classList.toggle('is-open', open);
  scrim.hidden = !(open && window.innerWidth <= 1080);
}

function setInspectorTab(tab) {
  ui.inspectorTab = tab;
  document.querySelectorAll('.ipanel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab;
  });
  document.querySelectorAll('.tab[data-tab]').forEach((button) => {
    button.setAttribute('aria-selected', String(button.dataset.tab === tab));
  });
  if (tab === 'queue') syncQueueInspector();
  if (tab === 'info') infoPanel.innerHTML = V.renderInfo(playback.current);
}

function openInspector(tab) {
  toggleInspector(true);
  setInspectorTab(tab);
}

function toggleFocus(force) {
  if (!focusMode) return;
  const open = typeof force === 'boolean' ? force : focusMode.hidden;
  if (open && !playback.current) {
    toast('Önce bir parça seç');
    return;
  }
  focusMode.hidden = !open;
  document.body.classList.toggle('is-focus', open);
  if (open) {
    syncTransport();
    syncPresetUI();
  }
}

function findTrack(id) {
  if (!id) return null;
  for (const key of Object.keys(V.lists)) {
    const found = V.lists[key].find((track) => track.id === id);
    if (found) return found;
  }
  if (playback.current && playback.current.id === id) return playback.current;
  const queued = playback.queue.find((track) => track.id === id);
  if (queued) return queued;
  if (library.likes[id]) return library.likes[id];
  const recent = library.recent.find((track) => track.id === id);
  if (recent) return recent;
  for (const playlist of library.playlists) {
    const found = playlist.tracks.find((track) => track.id === id);
    if (found) return found;
  }
  return null;
}

function resolveTrack(listName, id) {
  const list = V.lists[listName];
  if (Array.isArray(list) && list.length) {
    const index = list.findIndex((track) => track.id === id);
    if (index >= 0) return { track: list[index], queue: list, index };
  }
  const track = findTrack(id);
  return track ? { track, queue: [track], index: 0 } : null;
}

function setVerified(value) {
  settings.verifiedOnly = Boolean(value);
  save();
  syncVerifiedUI();
  toast(settings.verifiedOnly ? 'Yalnızca doğrulanmış sanatçılar' : 'Tüm katalog açık');
  route();
}

function openCreatePlaylistModal(trackId = '') {
  openModal(
    `<div class="modal__head">
      <span class="modal__title">Liste kur</span>
      <button class="iconbtn" data-act="close-overlay" aria-label="Kapat">${icon('x')}</button>
    </div>
    <div class="modal__body">
      <div class="field">
        <span>Liste adı</span>
        <input class="input" id="newPlaylistName" placeholder="Örn. gece sürüşü" maxlength="60" autocomplete="off">
      </div>
      <div class="note">${icon('library')}<span>Listeler yalnızca bu bilgisayarda saklanır. Bir parçayı sonra ekleyebilirsin.</span></div>
      <div class="modal__foot" style="border:0;padding:14px 0 0">
        <button class="btn btn--primary" data-act="create-playlist" data-track="${esc(trackId)}">Kur</button>
        <button class="btn btn--ghost" data-act="close-overlay">Vazgeç</button>
      </div>
    </div>`,
    { label: 'Liste kur' },
  );
}

function openPlaylistPicker(track) {
  if (!track) return;
  openModal(V.playlistPicker(track), { label: 'Listeye ekle' });
}

function openSettings() {
  openModal(V.renderSettings(), { label: 'Ayarlar' });
  syncSettingsUI();
}

function srgbToOklch([red, green, blue]) {
  const linear = (channel) =>
    channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  const r = linear(red);
  const g = linear(green);
  const b = linear(blue);
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  const lightness = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const chroma = Math.sqrt(a * a + bb * bb);
  let hue = (Math.atan2(bb, a) * 180) / Math.PI;
  if (hue < 0) hue += 360;
  return [lightness, chroma, hue];
}

function applyArtColors(track) {
  const url = track && (track.art || track.artSm);
  if (!url) return;
  const token = `${track.id}:${url}`;
  if (artToken === token) return;
  artToken = token;
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.decoding = 'async';
  image.src = api.img(url);
  image.onload = () => {
    if (artToken !== token) return;
    try {
      const size = 24;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, size, size);
      const { data } = context.getImageData(0, 0, size, size);
      let red = 0;
      let green = 0;
      let blue = 0;
      let weight = 0;
      for (let index = 0; index < data.length; index += 4) {
        const r = data[index] / 255;
        const g = data[index + 1] / 255;
        const b = data[index + 2] / 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const w = 0.08 + (max - min) * 2.2;
        red += r * w;
        green += g * w;
        blue += b * w;
        weight += w;
      }
      if (!weight) return;
      const [lightness, chroma, hue] = srgbToOklch([red / weight, green / weight, blue / weight]);
      const style = document.documentElement.style;
      style.setProperty(
        '--art-a',
        `${clamp(lightness, 0.44, 0.7).toFixed(3)} ${clamp(chroma, 0.05, 0.19).toFixed(3)} ${hue.toFixed(1)}`,
      );
      style.setProperty(
        '--art-b',
        `${clamp(lightness * 0.72, 0.3, 0.5).toFixed(3)} ${clamp(chroma * 0.9, 0.04, 0.15).toFixed(3)} ${((hue + 58) % 360).toFixed(1)}`,
      );
    } catch {
      /* görsel çözümlenemedi; varsayılan palet kalır */
    }
  };
}

function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const handlers = {
    play: () => {
      if (!playback.playing) player.toggle();
    },
    pause: () => {
      if (playback.playing) player.toggle();
    },
    previoustrack: () => player.prev(),
    nexttrack: () => player.next(),
    seekbackward: (details) => player.seekBy(-(details.seekOffset || 10)),
    seekforward: (details) => player.seekBy(details.seekOffset || 10),
  };
  for (const [name, handler] of Object.entries(handlers)) {
    try {
      navigator.mediaSession.setActionHandler(name, handler);
    } catch {
      /* desteklenmiyor */
    }
  }
}

function closePalette() {
  if (!paletteEl) return;
  paletteEl.remove();
  paletteEl = null;
  paletteItems = [];
  if (paletteRestore && typeof paletteRestore.focus === 'function') {
    paletteRestore.focus({ preventScroll: true });
  }
  paletteRestore = null;
}

function paletteCommands(query) {
  const q = String(query || '').trim().toLowerCase();
  const base = [
    { group: 'Git', label: 'Keşfet', icon: 'compass', hint: 'G', run: () => go('#/discover') },
    { group: 'Git', label: 'Ara', icon: 'search', hint: '/', run: () => goSearch('') },
    { group: 'Git', label: 'Kitaplık', icon: 'library', run: () => go('#/library') },
    { group: 'Git', label: 'Beğenilenler', icon: 'heart', run: () => go('#/liked') },
    { group: 'Git', label: 'Kuyruk', icon: 'queue', run: () => go('#/queue') },
    { group: 'Çal', label: playback.playing ? 'Duraklat' : 'Oynat', icon: playback.playing ? 'pause' : 'play', run: () => player.toggle() },
    { group: 'Çal', label: 'Sonraki parça', icon: 'next', run: () => player.next() },
    { group: 'Çal', label: 'Önceki parça', icon: 'prev', run: () => player.prev() },
    { group: 'Çal', label: 'Karıştırmayı aç / kapat', icon: 'shuffle', run: () => player.toggleShuffle() },
    { group: 'Motor', label: 'Akıllı motor', icon: 'spark', run: () => applyPreset('smart') },
    { group: 'Motor', label: '8D motoru', icon: 'spark', run: () => applyPreset('8d') },
    { group: 'Motor', label: 'Yörünge motoru', icon: 'spark', run: () => applyPreset('orbit') },
    { group: 'Motor', label: 'Gece modu', icon: 'spark', run: () => applyPreset('night') },
    { group: 'Motor', label: 'Motoru kapat', icon: 'x', run: () => applyPreset('off') },
    { group: 'Motor', label: 'Eşitleyiciyi düzle', icon: 'sliders', run: () => { engine.resetEq(); syncEqUI(); toast('Eşitleyici düzleşti'); } },
    { group: 'Kitaplık', label: 'Liste kur', icon: 'plus', run: () => openCreatePlaylistModal() },
    { group: 'Sistem', label: 'Ayarlar', icon: 'gear', run: () => openSettings() },
  ];
  const extra = [];
  if (q) {
    if (isUrlLike(query)) {
      extra.push({
        group: 'Bağlantı',
        label: 'Bağlantıyı aç',
        icon: 'link',
        hint: '↵',
        run: () => resolveLink(query.trim()),
      });
    }
    extra.push({
      group: 'Ara',
      label: `"${query.trim()}" ara`,
      icon: 'search',
      hint: '↵',
      run: () => goSearch(query.trim()),
    });
  }
  const items = [...extra, ...base];
  if (!q) return items;
  return items.filter(
    (item) =>
      item.label.toLocaleLowerCase('tr-TR').includes(q) ||
      item.group.toLocaleLowerCase('tr-TR').includes(q),
  );
}

function paintPalette() {
  const list = paletteEl && paletteEl.querySelector('#paletteList');
  if (!list) return;
  const input = paletteEl.querySelector('#paletteInput');
  paletteItems = paletteCommands(input ? input.value : '');
  paletteIndex = 0;
  let html = '';
  let lastGroup = '';
  paletteItems.forEach((item, index) => {
    if (item.group !== lastGroup) {
      html += `<div class="pgroup">${esc(item.group)}</div>`;
      lastGroup = item.group;
    }
    html += `<button class="pitem${index === 0 ? ' is-active' : ''}" role="option" data-palette-index="${index}">
      ${icon(item.icon)}<span>${esc(item.label)}</span>${item.hint ? `<small>${esc(item.hint)}</small>` : ''}
    </button>`;
  });
  list.innerHTML = html || '<div class="pgroup">Sonuç yok</div>';
}

function setPaletteActive(index) {
  const list = paletteEl && paletteEl.querySelector('#paletteList');
  if (!list) return;
  const buttons = [...list.querySelectorAll('[data-palette-index]')];
  if (!buttons.length) return;
  paletteIndex = (index + buttons.length) % buttons.length;
  buttons.forEach((button, buttonIndex) => {
    const active = buttonIndex === paletteIndex;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
    if (active) button.scrollIntoView({ block: 'nearest' });
  });
}

function runPaletteItem(index) {
  const item = paletteItems[index];
  if (!item) return;
  closePalette();
  item.run();
}

function openPalette() {
  if (paletteEl) return;
  if (isModalOpen()) closeModal();
  paletteRestore = document.activeElement;
  const element = document.createElement('div');
  element.className = 'palette';
  element.innerHTML = `<div class="palette__box" role="dialog" aria-modal="true" aria-label="Komut paleti">
    <div class="palette__top">
      ${icon('search')}
      <input class="palette__input" id="paletteInput" placeholder="Komut, parça ya da bağlantı" autocomplete="off" spellcheck="false" aria-label="Komut ara">
      <span class="palette__esc">esc</span>
    </div>
    <div class="palette__list" id="paletteList" role="listbox" aria-label="Komutlar"></div>
    <div class="palette__hint"><span>↑↓ gez</span><span>↵ seç</span><span>Ctrl K</span></div>
  </div>`;
  element.addEventListener('mousedown', (event) => {
    if (event.target === element) closePalette();
  });
  document.getElementById('overlayRoot').appendChild(element);
  paletteEl = element;
  const input = element.querySelector('#paletteInput');
  const list = element.querySelector('#paletteList');
  input.addEventListener('input', paintPalette);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closePalette();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setPaletteActive(paletteIndex + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setPaletteActive(paletteIndex - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      runPaletteItem(paletteIndex);
    } else if (event.key === 'Tab') {
      event.preventDefault();
    }
  });
  list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-palette-index]');
    if (button) runPaletteItem(Number(button.dataset.paletteIndex));
  });
  paintPalette();
  input.focus();
}

function setupKeyboard() {
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openPalette();
      return;
    }
    if (event.key === 'Escape') {
      if (isModalOpen()) {
        closeModal();
        return;
      }
      if (paletteEl) {
        closePalette();
        return;
      }
      if (focusMode && !focusMode.hidden) {
        toggleFocus(false);
        return;
      }
      if (ui.inspectorOpen && window.innerWidth <= 1080) toggleInspector(false);
      return;
    }
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable);
    if (typing) return;

    switch (event.key) {
      case ' ':
        event.preventDefault();
        player.toggle();
        break;
      case 'ArrowRight':
        event.preventDefault();
        player.seekBy(event.shiftKey ? 30 : 5);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        player.seekBy(event.shiftKey ? -30 : -5);
        break;
      case 'ArrowUp':
        event.preventDefault();
        player.setVolume(clamp(settings.volume + 0.05, 0, 1));
        break;
      case 'ArrowDown':
        event.preventDefault();
        player.setVolume(clamp(settings.volume - 0.05, 0, 1));
        break;
      case 'm':
        player.toggleMute();
        break;
      case 'l':
        if (playback.current) {
          toggleLike(playback.current);
          syncLikes();
        }
        break;
      case 'n':
        player.next();
        break;
      case 'p':
        player.prev();
        break;
      case 'q':
        openInspector('queue');
        break;
      case 'f':
        toggleFocus();
        break;
      case '/':
        event.preventDefault();
        openSearch();
        break;
      case '1':
        applyPreset('off');
        break;
      case '2':
        applyPreset('smart');
        break;
      case '3':
        applyPreset('8d');
        break;
      case '4':
        applyPreset('orbit');
        break;
      case '5':
        applyPreset('night');
        break;
      case '6':
        applyPreset('bass');
        break;
      case '+':
      case '=':
        player.setVolume(clamp(settings.volume + 0.05, 0, 1));
        break;
      case '-':
        player.setVolume(clamp(settings.volume - 0.05, 0, 1));
        break;
      default:
        break;
    }
  });
}

function setupInputs() {
  document.addEventListener('input', (event) => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement)) return;

    if (element === seek) {
      const duration = engine.getDuration() || playback.duration || 0;
      const fraction = Number(element.value) / 1000;
      if (duration > 0) {
        seekFill.style.transform = `scaleX(${fraction})`;
        timeNow.textContent = fmtTime(duration * fraction);
        player.seek(duration * fraction);
      }
      return;
    }

    if (element === volume || element.id === 'volumeSetting') {
      player.setVolume(Number(element.value) / 100);
      return;
    }

    if (element.dataset.eq !== undefined) {
      const index = Number(element.dataset.eq);
      engine.setEqBand(index, Number(element.value));
      paintRange(element);
      syncPresetUI();
      return;
    }

    const param = element.dataset.param;
    if (param) {
      const value = Number(element.value);
      if (param === 'depth') {
        engine.setDepth(value);
        depthOut.textContent = String(value);
      } else if (param === 'speed') {
        engine.setSpeed(value);
        speedOut.textContent = (value / 1000).toFixed(3);
      } else if (param === 'room') {
        engine.setRoom(value);
        roomOut.textContent = String(value);
      }
      paintRange(element);
      syncPresetUI();
      syncSpaceUI();
      return;
    }

    if (element.id === 'crossfade') {
      engine.setCrossfade(Number(element.value));
      paintRange(element);
      const out = $('#crossfadeOut');
      if (out) out.textContent = `${settings.crossfade} sn`;
    }
  });

  document.addEventListener('change', (event) => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement)) return;
    if (element.id === 'autolevel' || element.id === 'autolevelSetting') {
      engine.setAutolevel(element.checked);
      syncVolumeUI();
      return;
    }
    if (element.id === 'verifiedOnlySetting') {
      setVerified(element.checked);
    }
  });

  seek.addEventListener('pointerdown', () => {
    isSeeking = true;
  });
  seek.addEventListener('pointerup', () => {
    isSeeking = false;
    tickTransport();
  });
  seek.addEventListener('change', () => {
    isSeeking = false;
  });

  scrim.addEventListener('click', () => toggleInspector(false));
}

function setupActions() {
  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const action = target.dataset.act;
    const id = target.dataset.id;

    switch (action) {
      case 'open-search':
        openSearch();
        break;
      case 'open-settings':
        openSettings();
        break;
      case 'close-overlay':
        importState = null;
        closeModal();
        break;
      case 'toggle-focus':
        toggleFocus();
        break;
      case 'focus-queue':
        toggleFocus(false);
        openInspector('queue');
        break;
      case 'import-play': {
        if (!importState || !importState.matched.length) break;
        const queue = importState.matched.slice();
        importState = null;
        closeModal();
        player.play(queue[0], { queue, index: 0 });
        toast(`${queue.length} parçalık liste çalınıyor`);
        break;
      }
      case 'import-library': {
        if (!importState || !importState.playlistId) break;
        const playlistId = importState.playlistId;
        importState = null;
        closeModal();
        go(`#/local/${playlistId}`);
        break;
      }
      case 'toggle-inspector':
        toggleInspector();
        break;
      case 'inspector-tab':
        setInspectorTab(target.dataset.tab);
        break;
      case 'inspector-info':
        openInspector('info');
        break;
      case 'toggle-verified':
        setVerified(!settings.verifiedOnly);
        break;
      case 'toggle-play':
        player.toggle();
        break;
      case 'next':
        player.next();
        break;
      case 'prev':
        player.prev();
        break;
      case 'shuffle':
        player.toggleShuffle();
        break;
      case 'cycle-repeat':
        player.cycleRepeat();
        break;
      case 'toggle-mute':
        player.toggleMute();
        break;
      case 'toggle-like': {
        const track = findTrack(id) || (playback.current && playback.current.id === id ? playback.current : null);
        if (track) {
          const liked = toggleLike(track);
          syncLikes();
          toast(liked ? 'Beğenilere eklendi' : 'Beğeniden çıkarıldı');
          if (['library', 'liked', 'local'].includes(ui.route.name)) route();
        }
        break;
      }
      case 'queue-add': {
        const track = findTrack(id);
        if (track) player.addToQueue(track);
        break;
      }
      case 'add-to-playlist': {
        const track = findTrack(id);
        if (track) openPlaylistPicker(track);
        break;
      }
      case 'play-track': {
        const resolved = resolveTrack(target.dataset.list, id);
        if (resolved) player.play(resolved.track, { queue: resolved.queue, index: resolved.index });
        break;
      }
      case 'play-queued': {
        player.playQueued(Number(target.dataset.index));
        break;
      }
      case 'play-list': {
        const list = V.lists[target.dataset.list];
        if (list && list.length) player.play(list[0], { queue: list, index: 0 });
        break;
      }
      case 'shuffle-list': {
        const list = V.lists[target.dataset.list];
        if (list && list.length) {
          playback.shuffle = true;
          settings.shuffle = true;
          const index = Math.floor(Math.random() * list.length);
          player.play(list[index], { queue: list, index });
          syncPlaybackUI();
        }
        break;
      }
      case 'play-8d': {
        applyPreset('8d');
        const resolved = resolveTrack(target.dataset.list, id);
        if (resolved) player.play(resolved.track, { queue: resolved.queue, index: resolved.index });
        break;
      }
      case 'play-smart': {
        applyPreset('smart');
        const resolved = resolveTrack(target.dataset.list, id);
        if (resolved) player.play(resolved.track, { queue: resolved.queue, index: resolved.index });
        break;
      }
      case 'preset':
      case 'preset-quick':
        applyPreset(target.dataset.preset);
        break;
      case 'eq-reset':
        engine.resetEq();
        syncEqUI();
        syncPresetUI();
        toast('Eşitleyici düzleşti');
        break;
      case 'clear-queue':
        player.clearQueue();
        break;
      case 'queue-remove':
        player.removeFromQueue(Number(target.dataset.index));
        break;
      case 'search-tab': {
        ui.tab = target.dataset.tab;
        const results = $('#searchResults');
        if (ui.searchData && results) {
          results.innerHTML = V.searchResults(ui.searchData);
          afterRender();
        }
        break;
      }
      case 'search-retry':
        runSearch(ui.query);
        break;
      case 'search-suggestion': {
        const query = target.dataset.query || '';
        const input = $('#searchInput');
        if (input) input.value = query;
        goSearch(query);
        break;
      }
      case 'artist-sort':
        ui.artistSort = target.dataset.sort || 'plays';
        ui.cache.clear();
        route();
        break;
      case 'genre-time':
        ui.genreTime = target.dataset.time || 'week';
        ui.cache.clear();
        route();
        break;
      case 'retry':
        ui.cache.clear();
        route();
        break;
      case 'go-discover':
        go('#/discover');
        break;
      case 'go-library':
        go('#/library');
        break;
      case 'create-playlist': {
        const input = $('#newPlaylistName');
        if (input) {
          const playlist = createPlaylist(input.value);
          if (!playlist) {
            toast('Bir ad gir', 'error');
            break;
          }
          const trackId = target.dataset.track;
          if (trackId) {
            const track = findTrack(trackId);
            if (track) addToPlaylist(playlist.id, track);
          }
          closeModal();
          toast('Liste kuruldu');
          if (['library', 'local'].includes(ui.route.name)) route();
        } else {
          openCreatePlaylistModal(target.dataset.track || '');
        }
        break;
      }
      case 'delete-playlist': {
        const playlistId = target.dataset.id;
        if (deleteArm && deleteArm.id === playlistId && Date.now() - deleteArm.at < 4500) {
          deletePlaylist(playlistId);
          deleteArm = null;
          toast('Liste silindi');
          if (target.dataset.redirect) go('#/library');
          else if (['library', 'local'].includes(ui.route.name)) route();
        } else {
          deleteArm = { id: playlistId, at: Date.now() };
          toast('Silmek için aynı düğmeye tekrar bas');
        }
        break;
      }
      case 'pick-playlist': {
        const playlistId = target.dataset.id;
        const track = findTrack(target.dataset.track);
        if (playlistId && track) {
          const added = addToPlaylist(playlistId, track);
          closeModal();
          toast(added ? 'Listeye eklendi' : 'Bu parça zaten listede');
          if (ui.route.name === 'local') route();
        }
        break;
      }
      case 'playlist-remove': {
        if (ui.route.name === 'local') {
          removeFromPlaylist(ui.route.params.id, id);
          route();
          toast('Listeden çıkarıldı');
        }
        break;
      }
      case 'paste-link':
        pasteLink();
        break;
      case 'open-files':
        closeModal();
        if (fileInput) fileInput.click();
        break;
      case 'play-near': {
        const match = pendingNearMatch;
        pendingNearMatch = null;
        if (match) {
          closeModal();
          player.play(match.track, { queue: match.queue, index: match.index });
          toast('Tam kayıt açıldı');
        }
        break;
      }
      case 'open-embedded':
        if (lastLinkResult) openEmbed(lastLinkResult);
        break;
      case 'resolve-inline':
        resolveLink(target.dataset.url);
        break;
      case 'resolve-link': {
        const input = $('#linkInput');
        if (input) {
          closeModal();
          resolveLink(input.value);
        }
        break;
      }
      case 'find-on-playerify': {
        const query = target.dataset.query || '';
        closeModal();
        goSearch(query);
        break;
      }
      case 'set-motion':
        settings.motion = target.dataset.motion || 'auto';
        applyMotion();
        save();
        syncSettingsUI();
        break;
      case 'clear-data': {
        if (Date.now() - clearArm < 5000) {
          clearAllData();
          playback.queue = [];
          playback.index = -1;
          playback.current = null;
          playback.playing = false;
          engine.pause();
          closeModal();
          applyMotion();
          syncSettingsUI();
          syncTransport();
          syncPlaybackUI();
          ui.cache.clear();
          go('#/discover');
          toast('Yerel veriler temizlendi');
        } else {
          clearArm = Date.now();
          toast('Emin misin? 5 saniye içinde tekrar bas', 'error');
        }
        break;
      }
      default:
        break;
    }
  });
}

function setupStoreSubscriptions() {
  on('track', (track) => {
    syncTransport();
    applyArtColors(track);
  });

  on('playback', () => {
    syncPlaybackUI();
    if (ui.route.name === 'queue') {
      view.innerHTML = V.renderQueuePage();
      afterRender();
    }
  });

  on('tick', () => {
    /* ince konum güncellemeleri zamanlayıcıdan gelir */
  });

  on('settings', () => {
    syncSettingsUI();
  });

  on('library', () => {
    if (['library', 'liked', 'local'].includes(ui.route.name)) route();
    syncLikes();
  });
}

function startVisualLoop() {
  engine.startLoop((frame) => {
    orbit.draw(frame);
    const now = performance.now();
    if (now - lastMeterPaint < 95) return;
    lastMeterPaint = now;
    const toWidth = (db) => `${clamp(((db + 60) / 60) * 100, 0, 100).toFixed(1)}%`;
    meterL.style.width = toWidth(frame.levelDbL);
    meterR.style.width = toWidth(frame.levelDbR);
    meterDb.textContent = frame.levelDb > -70 ? frame.levelDb.toFixed(1) : '−∞';
    const label = player.presetLabel();
    const tag = settings.preset === 'off' ? 'motor kapalı' : `${label} · ${(settings.speed / 1000).toFixed(3)} Hz`;
    if (orbitTag.textContent !== tag) orbitTag.textContent = tag;
    orbitTag.classList.toggle('is-live', playback.playing && settings.preset !== 'off');
  });
}

function setupTimers() {
  window.setInterval(() => {
    if (playback.current) {
      playback.position = engine.getPosition();
      save();
    }
  }, 6000);
}

function setupNetwork() {
  const banner = $('#netBanner');
  const sync = () => {
    if (banner) banner.hidden = navigator.onLine;
  };
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();
}

function setupFiles() {
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      handleFiles(fileInput.files);
      fileInput.value = '';
    });
  }
  document.addEventListener('dragover', (event) => {
    if (event.dataTransfer && [...event.dataTransfer.types].includes('Files')) {
      event.preventDefault();
      document.body.classList.add('is-dragging');
    }
  });
  document.addEventListener('dragleave', (event) => {
    if (event.relatedTarget === null) document.body.classList.remove('is-dragging');
  });
  document.addEventListener('drop', (event) => {
    event.preventDefault();
    document.body.classList.remove('is-dragging');
    if (event.dataTransfer && event.dataTransfer.files.length) {
      handleFiles(event.dataTransfer.files);
    }
  });
}

function setupImageFallback() {
  document.addEventListener(
    'error',
    (event) => {
      if (event.target instanceof HTMLImageElement) {
        event.target.classList.add('is-broken');
      }
    },
    true,
  );
}

function importLegacyStorage() {
  if (location.hostname !== 'localhost') return false;
  const params = new URLSearchParams(location.search);
  const value = params.get('import');
  if (!value) return false;
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return false;
    if (!localStorage.getItem('playerify.v1')) {
      localStorage.setItem('playerify.v1', value);
    }
    localStorage.setItem('playerify.migrated', '1');
  } catch {
    return false;
  }
  params.delete('import');
  const query = params.toString();
  history.replaceState(
    null,
    '',
    `${location.pathname}${query ? `?${query}` : ''}${location.hash}`,
  );
  return true;
}

function migrateLegacyStorage() {
  if (location.hostname !== 'localhost') return false;
  try {
    if (localStorage.getItem('playerify.v1') || localStorage.getItem('playerify.migrated')) {
      return false;
    }
    localStorage.setItem('playerify.migrated', '1');
  } catch {
    return false;
  }
  const port = location.port || '80';
  location.replace(`http://127.0.0.1:${port}/?migrate=1#/discover`);
  return true;
}

async function boot() {
  importLegacyStorage();
  if (migrateLegacyStorage()) return;
  const hadServerState = await syncFromServer();
  const saved = hydrate();
  if (!hadServerState) saveNow();
  applyMotion();
  buildEq();
  paintAllRanges();
  syncSettingsUI();

  if (player.restore(saved.last)) {
    syncTransport();
  }
  syncPlaybackUI();
  setInspectorTab('signal');

  const autolevel = $('#autolevel');
  if (autolevel) autolevel.checked = settings.autolevel;

  setupInputs();
  setupActions();
  setupStoreSubscriptions();
  setupKeyboard();
  setupMediaSession();
  setupNetwork();
  setupImageFallback();
  setupFiles();
  setupTimers();
  startVisualLoop();

  if (volume) {
    volume.value = String(Math.round(settings.volume * 100));
    paintRange(volume);
  }

  window.addEventListener('hashchange', route);
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1080) {
      ui.inspectorOpen = false;
      inspector.classList.remove('is-open');
      scrim.hidden = true;
    }
  });

  if (!location.hash) {
    history.replaceState(null, '', '#/discover');
  }
  route();
  tickTransport();

  engine.decks.forEach((deckItem) => {
    const el = deckItem.el;
    el.addEventListener('timeupdate', tickTransport);
    el.addEventListener('progress', tickTransport);
    el.addEventListener('durationchange', tickTransport);
    el.addEventListener('play', () => {
      if (engine.decks[engine.active] && engine.decks[engine.active].el === el) {
        playback.playing = true;
        syncPlaybackUI();
      }
    });
    el.addEventListener('pause', () => {
      if (engine.decks[engine.active] && engine.decks[engine.active].el === el) {
        playback.playing = false;
        syncPlaybackUI();
      }
    });
    el.addEventListener('waiting', () => {
      if (engine.decks[engine.active] && engine.decks[engine.active].el === el) {
        playback.loading = true;
        emit('playback');
      }
    });
    el.addEventListener('canplay', () => {
      if (engine.decks[engine.active] && engine.decks[engine.active].el === el) {
        playback.loading = false;
        emit('playback');
      }
    });
  });
}

function serveMigration() {
  const legacy =
    location.hostname === '127.0.0.1' || location.hostname === '::1' || location.hostname === '[::1]';
  if (!legacy || !location.search.includes('migrate=1')) return false;
  const port = location.port || '80';
  const target = new URL(`http://localhost:${port}/`);
  target.hash = '/discover';
  try {
    const value = localStorage.getItem('playerify.v1');
    if (value && value.length < 900000) {
      target.searchParams.set('import', value);
    }
  } catch {
    /* depolama okunamadı */
  }
  location.replace(target.toString());
  return true;
}

if (!serveMigration()) {
  boot().catch((error) => console.error(error));
}
