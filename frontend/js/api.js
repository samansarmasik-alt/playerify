const json = async (url, options = {}) => {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    ...options,
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = body && body.error ? body.error : `İstek başarısız (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return body;
};

export const api = {
  home: () => json('/api/home'),
  search: (query, signal) => json(`/api/search?q=${encodeURIComponent(query)}`, { signal }),
  discover: (genre = '', time = 'week') =>
    json(`/api/discover?genre=${encodeURIComponent(genre)}&time=${encodeURIComponent(time)}`),
  track: (id) => json(`/api/tracks/${encodeURIComponent(id)}`),
  artist: (id, sort = 'plays') =>
    json(`/api/artists/${encodeURIComponent(id)}?sort=${encodeURIComponent(sort)}`),
  playlist: (id) => json(`/api/playlists/${encodeURIComponent(id)}`),
  resolve: (url) => json(`/api/resolve?url=${encodeURIComponent(url)}`),
  spotifyList: (url) => json(`/api/spotify/list?url=${encodeURIComponent(url)}`),
  youtubeMatch: (title, artist, duration) =>
    json(
      `/api/youtube/match?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist || '')}&duration=${encodeURIComponent(duration || 0)}`,
    ),
  stream: (track) => {
    if (!track) return '';
    const item = typeof track === 'string' ? { id: track } : track;
    if (item.source === 'local' && item.stream) {
      return item.stream;
    }
    if (item.source === 'youtube') {
      const videoId =
        item.videoId || (item.id && item.id.startsWith('yt:') ? item.id.slice(3) : '');
      if (videoId) return `/api/youtube/${encodeURIComponent(videoId)}/stream`;
    }
    if (item.preview && item.stream) {
      return `/api/audio?u=${encodeURIComponent(item.stream)}`;
    }
    return `/api/tracks/${encodeURIComponent(item.id)}/stream`;
  },
  img: (url) => (url ? `/api/img?u=${encodeURIComponent(url)}` : ''),
};
