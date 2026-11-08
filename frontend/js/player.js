import { AudioEngine, PRESETS } from './audio.js';
import { emit, playback, pushRecent, save, settings } from './store.js';
import { isModalOpen, openEmbed, toast } from './ui.js';

const elements = [document.getElementById('deckA'), document.getElementById('deckB')];
export const engine = new AudioEngine(elements);

let errorStreak = 0;
let failedSkips = 0;
let skipTimer = 0;
let autoAdvanceKey = '';

function scheduleSkip(delay = 500) {
  clearTimeout(skipTimer);
  skipTimer = window.setTimeout(() => player.next(true), delay);
}

engine.onEnded = () => {
  player.next(true);
};

let lastFailedId = '';

engine.onError = () => {
  const current = playback.current;
  if (current && current.source === 'youtube' && current.embed) {
    if (lastFailedId === current.id) return;
    lastFailedId = current.id;
    playback.playing = false;
    emit('playback');
    if (playback.queue.length > playback.index + 1) {
      toast('Bu video çalınamadı, sıradakine geçiyorum', 'error');
      player.next(true);
      return;
    }
    if (!isModalOpen()) {
      openEmbed({ ...current, kind: 'youtube' });
      toast('Ses çıkarılamadı, resmi oynatıcıya geçtim', 'error');
    }
    return;
  }
  errorStreak += 1;
  playback.playing = false;
  emit('playback');
  if (errorStreak <= 2) {
    toast('Bu kayıt açılamadı, sıradakine geçiyorum', 'error');
    scheduleSkip(400);
  } else {
    errorStreak = 0;
    toast('Ardışık kayıtlar açılamadı. Bağlantını kontrol et.', 'error');
  }
};

function queueIndexFor(track) {
  return playback.queue.findIndex((item) => item.id === track.id);
}

export const player = {
  engine,

  async play(track, options = {}) {
    if (!track || !track.id) return false;
    lastFailedId = '';
    autoAdvanceKey = '';
    if (track.embed && track.source !== 'youtube') {
      openEmbed({ ...track, kind: track.kind || 'youtube' });
      return false;
    }
    if (track.playable === false) {
      toast('Bu kayıt için uygulama içi önizleme yok. Kaynağı açabilirsin.', 'error');
      if (track.external) window.open(track.external, '_blank', 'noopener');
      return false;
    }
    const { queue = null, index = 0, autoplay = true, position = 0 } = options;

    if (queue && queue.length) {
      playback.queue = queue.filter((item) => item && item.id);
      const found = playback.queue.findIndex((item) => item.id === track.id);
      playback.index = found >= 0 ? found : Math.max(0, Math.min(index, playback.queue.length - 1));
    } else {
      const existing = queueIndexFor(track);
      if (existing >= 0) {
        playback.index = existing;
      } else {
        const insertAt = playback.index >= 0 ? playback.index + 1 : playback.queue.length;
        playback.queue.splice(insertAt, 0, track);
        playback.index = insertAt;
      }
    }

    playback.current = track;
    playback.loading = true;
    playback.position = Number(position) || 0;
    playback.duration = Number(track.duration) || 0;
    playback.playing = false;
    engine.setTrackMeta(track);
    emit('track', track);
    emit('playback');

    try {
      await engine.load(track, { autoplay, position });
      playback.loading = false;
      playback.playing = Boolean(autoplay);
      playback.position = engine.getPosition() || playback.position;
      playback.duration = engine.getDuration() || playback.duration;
      if (track.source === 'local') {
        const duration = Math.round(engine.getDuration());
        if (duration > 0) {
          track.duration = duration;
          track.fullDuration = duration;
        }
      }
      errorStreak = 0;
      failedSkips = 0;
      pushRecent(track);
      save();
      emit('playback');
      return true;
    } catch (error) {
      playback.loading = false;
      playback.playing = false;
      emit('playback');
      if (track.source === 'youtube' && track.embed) {
        openEmbed({ ...track, kind: 'youtube' });
        toast('Ses çıkarılamadı, resmi oynatıcı açıldı', 'error');
        return false;
      }
      if (error && error.name === 'NotAllowedError') {
        toast('Tarayıcı otomatik oynatmayı engelledi. Bir kez daha bas.', 'error');
        return false;
      }
      failedSkips += 1;
      if (
        failedSkips <= 3 &&
        (playback.index + 1 < playback.queue.length || playback.repeat === 'all')
      ) {
        toast('Bu kayıt açılamadı, sıradakine geçiyorum', 'error');
        scheduleSkip(700);
      } else {
        failedSkips = 0;
        toast('Bu kayıt açılamadı. Başka bir sonuç dene.', 'error');
      }
      return false;
    }
  },

  async toggle() {
    if (!playback.current) {
      if (playback.queue.length) {
        return this.play(playback.queue[0], { queue: playback.queue, index: 0 });
      }
      toast('Önce bir parça seç');
      return false;
    }
    if (playback.playing) {
      await engine.pause();
      playback.playing = false;
      emit('playback');
      save();
      return false;
    }
    try {
      const resumed = await engine.resume();
      if (resumed) {
        playback.playing = true;
        emit('playback');
        save();
        return true;
      }
    } catch {
      /* yeni yükleme gerekli */
    }
    return this.play(playback.current, {
      queue: playback.queue,
      index: playback.index,
      position: playback.position,
      autoplay: true,
    });
  },

  next(auto = false) {
    const queue = playback.queue;
    if (!queue.length) return;
    if (auto && playback.repeat === 'one') {
      this.play(queue[playback.index] || queue[0], {
        queue,
        index: playback.index >= 0 ? playback.index : 0,
      });
      return;
    }
    let nextIndex = -1;
    if (playback.shuffle && queue.length > 1) {
      let candidate = playback.index;
      for (let attempt = 0; attempt < 20 && candidate === playback.index; attempt += 1) {
        candidate = Math.floor(Math.random() * queue.length);
      }
      nextIndex = candidate;
    } else if (playback.index + 1 < queue.length) {
      nextIndex = playback.index + 1;
    } else if (playback.repeat === 'all') {
      nextIndex = 0;
    }
    if (nextIndex < 0) {
      if (auto) {
        engine.pause();
        playback.playing = false;
        emit('playback');
        save();
      }
      return;
    }
    this.play(queue[nextIndex], { queue, index: nextIndex });
  },

  prev() {
    if (!playback.current) return;
    if (engine.getPosition() > 5) {
      this.seek(0);
      return;
    }
    const queue = playback.queue;
    if (!queue.length) return;
    let index = playback.index - 1;
    if (index < 0) {
      index = playback.repeat === 'all' ? queue.length - 1 : 0;
    }
    this.play(queue[index], { queue, index });
  },

  seek(seconds) {
    engine.seek(seconds);
    playback.position = Math.max(0, Number(seconds) || 0);
    emit('tick');
  },

  seekBy(delta) {
    this.seek(engine.getPosition() + Number(delta || 0));
  },

  seekFraction(fraction) {
    const duration = engine.getDuration() || playback.duration || 0;
    if (duration > 0) this.seek(duration * Math.min(1, Math.max(0, fraction)));
  },

  setVolume(value) {
    engine.setVolume(value);
    emit('settings');
  },

  toggleMute() {
    engine.setMuted(!engine.muted);
    emit('settings');
  },

  toggleShuffle() {
    playback.shuffle = !playback.shuffle;
    settings.shuffle = playback.shuffle;
    save();
    emit('playback');
  },

  cycleRepeat() {
    const order = ['off', 'all', 'one'];
    playback.repeat = order[(order.indexOf(playback.repeat) + 1) % order.length];
    settings.repeat = playback.repeat;
    save();
    emit('playback');
    const labels = { off: 'kapalı', all: 'tüm kuyruk', one: 'tek parça' };
    toast(`Tekrar: ${labels[playback.repeat]}`);
  },

  addToQueue(track) {
    if (!track || !track.id) return;
    if (track.embed && track.source !== 'youtube') {
      toast('Bu kayıt yalnızca gömülü oynatıcıyla açılır');
      return;
    }
    if (!playback.current) {
      this.play(track, { queue: [track], index: 0 });
      return;
    }
    if (playback.queue.some((item) => item.id === track.id)) {
      toast('Bu parça zaten kuyrukta');
      return;
    }
    const at = playback.index + 1;
    playback.queue.splice(at, 0, track);
    save();
    emit('playback');
    toast('Kuyruğa eklendi');
  },

  playNext(track) {
    if (!track || !track.id) return;
    if (track.embed && track.source !== 'youtube') {
      toast('Bu kayıt yalnızca gömülü oynatıcıyla açılır');
      return;
    }
    if (!playback.current) {
      this.play(track, { queue: [track], index: 0 });
      return;
    }
    playback.queue = playback.queue.filter((item) => item.id !== track.id);
    playback.queue.splice(playback.index + 1, 0, track);
    save();
    emit('playback');
    toast('Sıradaki parça olarak eklendi');
  },

  removeFromQueue(index) {
    if (index === playback.index) {
      toast('Çalan parça kuyruktan çıkarılamaz');
      return;
    }
    if (index < 0 || index >= playback.queue.length) return;
    playback.queue.splice(index, 1);
    if (index < playback.index) playback.index -= 1;
    save();
    emit('playback');
  },

  clearQueue() {
    if (!playback.current) {
      playback.queue = [];
      playback.index = -1;
    } else {
      playback.queue = [playback.current];
      playback.index = 0;
    }
    save();
    emit('playback');
    toast('Kuyruk temizlendi');
  },

  playQueued(index) {
    const track = playback.queue[index];
    if (track) this.play(track, { queue: playback.queue, index });
  },

  restore(saved) {
    if (!saved || !saved.track || !saved.track.id) return false;
    playback.current = saved.track;
    const queue = Array.isArray(saved.queue) && saved.queue.length ? saved.queue : [saved.track];
    playback.queue = queue.filter((item) => item && item.id);
    const index = playback.queue.findIndex((item) => item.id === saved.track.id);
    playback.index = index >= 0 ? index : 0;
    playback.position = Math.max(0, Number(saved.position) || 0);
    playback.duration = Number(saved.track.duration) || 0;
    playback.playing = false;
    engine.setTrackMeta(saved.track);
    return true;
  },

  preloadNext() {
    const queue = playback.queue;
    if (!queue.length) return;
    let index = playback.index + 1;
    if (index >= queue.length && playback.repeat === 'all') index = 0;
    if (index < queue.length && queue[index]) engine.preload(queue[index]);
  },

  maybeAutoAdvance(position, duration) {
    if (!playback.playing || !playback.current || playback.repeat === 'one') return false;
    const crossfade = Math.max(0, Number(settings.crossfade) || 0);
    if (crossfade <= 0 || duration <= 0) return false;
    const remaining = duration - position;
    if (position < 0.5 || remaining > crossfade + 0.25 || remaining < 0.05) return false;
    const hasNext =
      playback.index + 1 < playback.queue.length || playback.repeat === 'all';
    if (!hasNext) return false;
    const key = `${playback.current.id}:${playback.index}`;
    if (autoAdvanceKey === key) return false;
    autoAdvanceKey = key;
    this.next(true);
    return true;
  },

  setPreset(name) {
    const preset = engine.setPreset(name);
    emit('settings');
    return preset;
  },

  presetLabel() {
    const preset = PRESETS[settings.preset];
    return preset ? preset.label : 'Özel';
  },
};
