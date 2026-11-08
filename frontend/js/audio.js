import { api } from './api.js';
import { save, settings } from './store.js';

export const BANDS = [60, 150, 400, 1000, 2400, 6000, 12000];

export const PRESETS = {
  smart: {
    label: 'Akıllı',
    depth: 0.72,
    speed: 0.085,
    room: 0.26,
    eq: [1.2, 0.8, 0, -0.6, 0, 0.7, 1.1],
    glue: { threshold: -19, ratio: 2.4 },
  },
  off: {
    label: 'Kapalı',
    depth: 0,
    speed: 0.08,
    room: 0,
    eq: [0, 0, 0, 0, 0, 0, 0],
    glue: { threshold: -18, ratio: 2.2 },
  },
  '8d': {
    label: '8D',
    depth: 0.85,
    speed: 0.085,
    room: 0.34,
    eq: [1.5, 1, 0, -0.5, 0, 0.8, 1.2],
    glue: { threshold: -19, ratio: 2.4 },
  },
  orbit: {
    label: 'Yörünge',
    depth: 0.95,
    speed: 0.14,
    room: 0.28,
    eq: [2, 1.5, 0, -1, 0, 1, 1.5],
    glue: { threshold: -19, ratio: 2.6 },
  },
  night: {
    label: 'Gece',
    depth: 0,
    speed: 0.08,
    room: 0,
    eq: [2.5, 1.5, 0, 0, -1.5, -1, 0],
    glue: { threshold: -30, ratio: 4.5 },
  },
  bass: {
    label: 'Bas',
    depth: 0.55,
    speed: 0.07,
    room: 0.2,
    eq: [6, 4, 1, -2, -1, 0, 0],
    glue: { threshold: -20, ratio: 2.4 },
  },
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const volumeCurve = (value) => Math.pow(clamp(Number(value) || 0, 0, 1), 2.1);

export class AudioEngine {
  constructor(elements) {
    this.elements = elements.filter(Boolean);
    this.ctx = null;
    this.decks = [];
    this.active = 0;
    this.playing = false;
    this.angle = 0;
    this.lastFrame = 0;
    this.depth = 0.85;
    this.speed = 0.085;
    this.room = 0.34;
    this.crossfade = 4;
    this.volume = 0.8;
    this.muted = false;
    this.autolevel = true;
    this.levelGainDb = 0;
    this.levelDb = -80;
    this.levelDbL = -80;
    this.levelDbR = -80;
    this.trackMeta = null;
    this.previewMode = false;
    this.smart = true;
    this.baseDepth = 0.72;
    this.smartDepth = 0.72;
    this.smartInfo = { bpm: 0, period: 14, room: 0.26 };
    this._lastSmart = 0;
    this.onEnded = null;
    this.onError = null;
    this.onFrame = null;
    this._frame = 0;
    this._fadeTimer = 0;
    this._lastLevelRead = 0;
    this._lastAdjust = 0;
    this._raf = 0;
    this._loopCallback = null;
    this._lastPaint = 0;
    this._visibilityBound = false;
  }

  init() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new Error('Tarayıcı Web Audio desteklemiyor');
    const ctx = new Ctx({ latencyHint: 'playback' });
    this.ctx = ctx;

    const gain = (value = 1) => {
      const node = ctx.createGain();
      node.gain.value = value;
      return node;
    };

    this.preGain = gain(1);
    this.eqIn = gain(1);
    this.eqNodes = BANDS.map((frequency, index) => {
      const filter = ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = frequency;
      filter.Q.value = index === 0 ? 0.9 : index === BANDS.length - 1 ? 0.8 : 1.05;
      filter.gain.value = 0;
      return filter;
    });

    this.glue = ctx.createDynamicsCompressor();
    this.glue.threshold.value = -19;
    this.glue.knee.value = 22;
    this.glue.ratio.value = 2.4;
    this.glue.attack.value = 0.008;
    this.glue.release.value = 0.22;

    this.spatialIn = gain(1);
    const crossover = (type) => {
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = 140;
      filter.Q.value = 0.707;
      return filter;
    };
    this.bassLow1 = crossover('lowpass');
    this.bassLow2 = crossover('lowpass');
    this.bassGain = gain(1);
    this.highHigh1 = crossover('highpass');
    this.highHigh2 = crossover('highpass');
    this.highDirect = gain(1);
    this.orbitGain = gain(0);
    this.wetGain = gain(0);

    this.panner = ctx.createPanner();
    this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 2.2;
    this.panner.maxDistance = 40;
    this.panner.rolloffFactor = 0.55;
    this.panner.coneInnerAngle = 360;
    this.hrtfGain = gain(0);
    this.stereoPanner = ctx.createStereoPanner();
    this.stereoGain = gain(0);

    this.convolver = ctx.createConvolver();
    this.convolver.normalize = true;
    this.convolver.buffer = this._impulse(ctx);

    this.bus = gain(1);
    this.master = gain(volumeCurve(this.volume));

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -2;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.15;

    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.82;

    this.splitter = ctx.createChannelSplitter(2);
    this.analyserL = ctx.createAnalyser();
    this.analyserR = ctx.createAnalyser();
    this.analyserL.fftSize = 512;
    this.analyserR.fftSize = 512;
    this.silentL = gain(0);
    this.silentR = gain(0);

    this.preGain.connect(this.eqIn);
    let tail = this.eqIn;
    for (const filter of this.eqNodes) {
      tail.connect(filter);
      tail = filter;
    }
    tail.connect(this.glue);
    this.glue.connect(this.spatialIn);
    this.spatialIn.connect(this.bassLow1);
    this.bassLow1.connect(this.bassLow2);
    this.bassLow2.connect(this.bassGain);
    this.bassGain.connect(this.bus);
    this.spatialIn.connect(this.highHigh1);
    this.highHigh1.connect(this.highHigh2);
    this.highHigh2.connect(this.highDirect);
    this.highDirect.connect(this.bus);
    this.highHigh2.connect(this.orbitGain);
    this.orbitGain.connect(this.panner);
    this.panner.connect(this.hrtfGain);
    this.hrtfGain.connect(this.bus);
    this.orbitGain.connect(this.stereoPanner);
    this.stereoPanner.connect(this.stereoGain);
    this.stereoGain.connect(this.bus);
    this.highHigh2.connect(this.wetGain);
    this.wetGain.connect(this.convolver);
    this.convolver.connect(this.bus);
    this.bus.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(this.analyser);
    this.analyser.connect(ctx.destination);
    this.limiter.connect(this.splitter);
    this.splitter.connect(this.analyserL, 0);
    this.splitter.connect(this.analyserR, 1);
    this.analyserL.connect(this.silentL);
    this.silentL.connect(ctx.destination);
    this.analyserR.connect(this.silentR);
    this.silentR.connect(ctx.destination);

    this.decks = this.elements.map((el) => {
      const source = ctx.createMediaElementSource(el);
      const deckGain = gain(0);
      source.connect(deckGain);
      deckGain.connect(this.preGain);
      el.addEventListener('ended', () => {
        if (this.decks[this.active] && this.decks[this.active].el === el && this.onEnded) {
          this.onEnded();
        }
      });
      el.addEventListener('error', () => {
        if (this.decks[this.active] && this.decks[this.active].el === el && this.onError) {
          this.onError(el.error);
        }
      });
      return { el, source, gain: deckGain };
    });

    this.timeData = new Float32Array(this.analyser.fftSize);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this.leftData = new Float32Array(this.analyserL.fftSize);
    this.rightData = new Float32Array(this.analyserR.fftSize);

    this.applySettings();
    return ctx;
  }

  _impulse(ctx) {
    const rate = ctx.sampleRate;
    const length = Math.floor(rate * 1.9);
    const preDelay = Math.floor(rate * 0.012);
    const buffer = ctx.createBuffer(2, length, rate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      let damped = 0;
      for (let index = 0; index < length; index += 1) {
        const progress = index / length;
        const noise = Math.random() * 2 - 1;
        damped = damped * 0.74 + noise * 0.26;
        data[index] = index < preDelay ? 0 : damped * Math.pow(1 - progress, 3.2) * 0.7;
      }
    }
    return buffer;
  }

  applySettings() {
    if (!this.ctx) return;
    this.volume = clamp(Number(settings.volume) || 0, 0, 1);
    this.muted = Boolean(settings.muted);
    this.crossfade = clamp(Number(settings.crossfade) || 0, 0, 12);
    this.autolevel = Boolean(settings.autolevel);
    this.depth = clamp(Number(settings.depth) / 100 || 0, 0, 1);
    this.baseDepth = clamp(this.depth || 0.72, 0.3, 0.95);
    this.smartDepth = this.baseDepth;
    this.speed = clamp(Number(settings.speed) / 1000 || 0.085, 0.02, 0.22);
    this.room = clamp(Number(settings.room) / 100 || 0, 0, 1);
    this.smart = settings.preset === 'smart';
    this.levelGainDb = 0;
    this.preGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.1);
    this._applyVolume();
    this._applySpace();
    this.setEq(settings.eq, false);
    this._applyGlue(PRESETS[settings.preset] || PRESETS['8d']);
  }

  _applyVolume() {
    if (!this.ctx) return;
    const target = this.muted ? 0 : volumeCurve(this.volume);
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.04);
  }

  _applySpace() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const depthFactor = this.previewMode ? 0.28 : 1;
    const roomFactor = this.previewMode ? 0.12 : 1;
    const depth = clamp(this.depth * depthFactor, 0, 1);
    const direct = Math.cos((depth * Math.PI) / 2);
    const orbit = Math.sin((depth * Math.PI) / 2);
    this.highDirect.gain.setTargetAtTime(direct, now, 0.07);
    this.orbitGain.gain.setTargetAtTime(orbit, now, 0.07);
    this.wetGain.gain.setTargetAtTime(clamp(this.room * roomFactor, 0, 1) * 0.62, now, 0.1);
    const useHrtf = settings.preset === '8d' || settings.preset === 'orbit';
    this.hrtfGain.gain.setTargetAtTime(useHrtf ? 1 : 0, now, 0.1);
    this.stereoGain.gain.setTargetAtTime(useHrtf ? 0 : 1, now, 0.1);
    this.limiter.threshold.setTargetAtTime(this.previewMode ? -3 : -2, now, 0.06);
    this.limiter.ratio.setTargetAtTime(this.previewMode ? 12 : 20, now, 0.06);
    if (depth === 0) {
      this.panner.positionX.setTargetAtTime(0, now, 0.06);
      this.panner.positionY.setTargetAtTime(0, now, 0.06);
      this.panner.positionZ.setTargetAtTime(-1.6, now, 0.06);
    }
  }

  _applyGlue(preset) {
    if (!this.ctx || !preset) return;
    const glue = preset.glue || PRESETS['8d'].glue;
    this.glue.threshold.setTargetAtTime(glue.threshold, this.ctx.currentTime, 0.05);
    this.glue.ratio.setTargetAtTime(glue.ratio, this.ctx.currentTime, 0.05);
  }

  setVolume(value) {
    this.volume = clamp(Number(value) || 0, 0, 1);
    settings.volume = this.volume;
    this._applyVolume();
    save();
  }

  setMuted(value) {
    this.muted = Boolean(value);
    settings.muted = this.muted;
    this._applyVolume();
    save();
  }

  setCrossfade(value) {
    this.crossfade = clamp(Number(value) || 0, 0, 12);
    settings.crossfade = this.crossfade;
    save();
  }

  setAutolevel(value) {
    this.autolevel = Boolean(value);
    settings.autolevel = this.autolevel;
    if (!this.autolevel && this.ctx) {
      this.levelGainDb = 0;
      this.preGain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.2);
    }
    save();
  }

  setDepth(percent, persist = true) {
    const value = clamp(Number(percent) / 100, 0, 1);
    this.depth = value;
    if (this.smart) {
      this.baseDepth = clamp(value, 0.3, 0.95);
      this.smartDepth = value;
    }
    if (persist) {
      settings.depth = Math.round(value * 100);
      if (!this.smart) settings.preset = 'custom';
      save();
    }
    this._applySpace();
  }

  setSpeed(attribute, persist = true) {
    this.speed = clamp(Number(attribute) / 1000, 0.02, 0.22);
    if (persist) {
      settings.speed = Math.round(this.speed * 1000);
      settings.preset = 'custom';
      this.smart = false;
      save();
    }
  }

  setRoom(percent, persist = true) {
    this.room = clamp(Number(percent) / 100, 0, 1);
    if (persist) {
      settings.room = Math.round(this.room * 100);
      if (!this.smart) settings.preset = 'custom';
      save();
    }
    this._applySpace();
  }

  setEq(values, persist = true) {
    if (!this.ctx) {
      settings.eq = values.map((value) => clamp(Number(value) || 0, -9, 9));
      return;
    }
    const now = this.ctx.currentTime;
    this.eqNodes.forEach((filter, index) => {
      const db = clamp(Number(values[index]) || 0, -9, 9);
      filter.gain.setTargetAtTime(db, now, 0.06);
    });
    settings.eq = values.map((value) => clamp(Number(value) || 0, -9, 9));
    if (persist) save();
  }

  setEqBand(index, db) {
    if (!this.ctx) return;
    const filter = this.eqNodes[index];
    if (!filter) return;
    const value = clamp(Number(db) || 0, -9, 9);
    filter.gain.setTargetAtTime(value, this.ctx.currentTime, 0.05);
    settings.eq[index] = value;
    save();
  }

  resetEq() {
    this.setEq([0, 0, 0, 0, 0, 0, 0]);
  }

  setTrackMeta(track) {
    this.trackMeta = track || null;
    this.previewMode = Boolean(track && track.preview);
    if (settings.preset === 'smart') this.applySmart();
    else this._applySpace();
  }

  applySmart(persist = true) {
    const bpm = Number(this.trackMeta && this.trackMeta.bpm) || 0;
    const period = bpm >= 60 && bpm <= 200 ? clamp((32 * 60) / bpm, 8, 20) : 14;
    this.speed = 1 / period;

    const genre = String((this.trackMeta && this.trackMeta.genre) || '').toLowerCase();
    let room = 0.26;
    if (genre.includes('ambient') || genre.includes('classical')) room = 0.42;
    else if (genre.includes('jazz') || genre.includes('r&b') || genre.includes('soul')) room = 0.34;
    else if (genre.includes('rock') || genre.includes('pop') || genre.includes('alternative')) room = 0.3;
    else if (genre.includes('hip-hop') || genre.includes('rap')) room = 0.24;
    else if (
      genre.includes('techno') ||
      genre.includes('house') ||
      genre.includes('dubstep') ||
      genre.includes('drum') ||
      genre.includes('electronic')
    ) {
      room = 0.18;
    }

    this.room = room;
    this.baseDepth = clamp(Number(settings.depth) / 100 || 0.72, 0.35, 0.95);
    this.smartDepth = this.baseDepth;
    this.depth = this.baseDepth;
    this.smart = true;
    settings.preset = 'smart';
    settings.speed = Math.round(this.speed * 1000);
    settings.room = Math.round(room * 100);
    settings.depth = Math.round(this.baseDepth * 100);
    this.smartInfo = { bpm, period, room };
    if (this.ctx) {
      this._applySpace();
      this._applyGlue(PRESETS.smart);
    }
    if (persist) save();
  }

  setPreset(name) {
    const key = PRESETS[name] ? name : 'smart';
    const preset = PRESETS[key];
    this.smart = key === 'smart';
    this.depth = preset.depth;
    this.baseDepth = clamp(preset.depth, 0.3, 0.95);
    this.smartDepth = preset.depth;
    this.speed = preset.speed;
    this.room = preset.room;
    settings.preset = key;
    settings.depth = Math.round(preset.depth * 100);
    settings.speed = Math.round(preset.speed * 1000);
    settings.room = Math.round(preset.room * 100);
    if (this.smart) this.applySmart(false);
    this._applySpace();
    this._applyGlue(preset);
    this.setEq(preset.eq);
    save();
    return preset;
  }

  async load(track, { autoplay = true, position = 0 } = {}) {
    this.init();
    const needsResume = this.ctx.state === 'suspended';
    const now = this.ctx.currentTime;
    const crossfading = this.playing && this.crossfade > 0;
    const targetIndex = this.playing ? 1 - this.active : this.active;
    const deck = this.decks[targetIndex];
    const previous = this.decks[this.active];
    if (!deck) throw new Error('Ses kanalı hazır değil');

    const url = api.stream(track);
    if (!deck.el.src.endsWith(url)) {
      deck.el.src = url;
      deck.el.load();
    }

    if (position > 0) {
      const apply = () => {
        try {
          deck.el.currentTime = position;
        } catch {
          /* metadata henüz hazır değil */
        }
      };
      if (deck.el.readyState >= 1) apply();
      else deck.el.addEventListener('loadedmetadata', apply, { once: true });
    }

    deck.gain.gain.cancelScheduledValues(now);
    deck.gain.gain.setValueAtTime(crossfading ? 0.0001 : 1, now);
    if (crossfading) {
      deck.gain.gain.exponentialRampToValueAtTime(1, now + this.crossfade);
    }

    clearTimeout(this._fadeTimer);
    this._fadeTimer = 0;
    if (this.playing && targetIndex !== this.active && previous) {
      previous.gain.gain.cancelScheduledValues(now);
      previous.gain.gain.setValueAtTime(Math.max(previous.gain.gain.value, 0.0001), now);
      previous.gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + (crossfading ? this.crossfade : 0.04),
      );
      const pauseAt = crossfading ? this.crossfade * 1000 : 80;
      this._fadeTimer = window.setTimeout(() => {
        previous.el.pause();
        previous.gain.gain.value = 0;
        this._fadeTimer = 0;
      }, pauseAt + 40);
    }

    this.active = targetIndex;
    this.playing = false;

    let playPromise = null;
    if (autoplay) {
      playPromise = deck.el.play();
    } else {
      deck.el.pause();
    }
    if (needsResume) {
      try {
        await this.ctx.resume();
      } catch {
        /* tarayıcı istemi reddetti */
      }
    }
    if (playPromise && typeof playPromise.then === 'function') {
      await playPromise;
    }
    this.playing = autoplay;
    return true;
  }

  preload(track) {
    if (!this.ctx || !this.playing || !track || this._fadeTimer) return;
    const other = this.decks[1 - this.active];
    if (!other) return;
    const url = api.stream(track);
    if (other.el.src.endsWith(url)) return;
    other.gain.gain.value = 0;
    other.el.src = url;
    other.el.preload = 'auto';
    other.el.load();
  }

  async pause() {
    if (!this.ctx) return;
    clearTimeout(this._fadeTimer);
    this._fadeTimer = 0;
    this.playing = false;
    this.levelDb = -80;
    this.levelDbL = -80;
    this.levelDbR = -80;
    for (const deck of this.decks) {
      deck.el.pause();
      deck.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      deck.gain.gain.setValueAtTime(0, this.ctx.currentTime);
    }
    if (this.decks[this.active]) {
      this.decks[this.active].gain.gain.setValueAtTime(1, this.ctx.currentTime);
    }
  }

  async resume() {
    this.init();
    const deck = this.decks[this.active];
    if (!deck || !deck.el.src) return false;
    const now = this.ctx.currentTime;
    deck.gain.gain.cancelScheduledValues(now);
    deck.gain.gain.setValueAtTime(1, now);
    const promise = deck.el.play();
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        /* tarayıcı istemi reddetti */
      }
    }
    if (promise && typeof promise.then === 'function') await promise;
    this.playing = true;
    return true;
  }

  seek(seconds) {
    const deck = this.decks[this.active];
    if (!deck) return;
    const duration = Number.isFinite(deck.el.duration) ? deck.el.duration : Number.MAX_SAFE_INTEGER;
    try {
      deck.el.currentTime = clamp(Number(seconds) || 0, 0, duration);
    } catch {
      /* yok say */
    }
  }

  getPosition() {
    const deck = this.decks[this.active];
    return deck && Number.isFinite(deck.el.currentTime) ? deck.el.currentTime : 0;
  }

  getDuration() {
    const deck = this.decks[this.active];
    return deck && Number.isFinite(deck.el.duration) && deck.el.duration > 0
      ? deck.el.duration
      : 0;
  }

  getBuffered() {
    const deck = this.decks[this.active];
    if (!deck || !deck.el.buffered || !deck.el.buffered.length) return 0;
    const end = deck.el.buffered.end(deck.el.buffered.length - 1);
    const duration = this.getDuration();
    return duration > 0 ? clamp(end / duration, 0, 1) : 0;
  }

  _readLevels() {
    if (!this.analyser) return;
    this.analyser.getByteFrequencyData(this.freqData);
    this.analyser.getFloatTimeDomainData(this.timeData);
    let sum = 0;
    for (let index = 0; index < this.timeData.length; index += 1) {
      sum += this.timeData[index] * this.timeData[index];
    }
    const rms = Math.sqrt(sum / this.timeData.length);
    this.levelDb = 20 * Math.log10(rms + 1e-7);

    this.analyserL.getFloatTimeDomainData(this.leftData);
    this.analyserR.getFloatTimeDomainData(this.rightData);
    let left = 0;
    let right = 0;
    for (let index = 0; index < this.leftData.length; index += 1) {
      left += this.leftData[index] * this.leftData[index];
      right += this.rightData[index] * this.rightData[index];
    }
    this.levelDbL = 20 * Math.log10(Math.sqrt(left / this.leftData.length) + 1e-7);
    this.levelDbR = 20 * Math.log10(Math.sqrt(right / this.rightData.length) + 1e-7);
  }

  _correlation() {
    const left = this.leftData;
    const right = this.rightData;
    let cross = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;
    for (let index = 0; index < left.length; index += 1) {
      cross += left[index] * right[index];
      leftEnergy += left[index] * left[index];
      rightEnergy += right[index] * right[index];
    }
    return cross / Math.sqrt(leftEnergy * rightEnergy + 1e-9);
  }

  startLoop(callback) {
    this.init();
    if (callback) this._loopCallback = callback;
    if (!this._visibilityBound) {
      this._visibilityBound = true;
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && !this._raf && this._loopCallback) {
          this.startLoop(this._loopCallback);
        }
      });
    }
    if (this._raf) return;
    this._raf = requestAnimationFrame((time) => this._loopTick(time));
  }

  _loopTick(time) {
    this._raf = 0;
    if (document.hidden) return;
    const delta = this.lastFrame ? Math.min((time - this.lastFrame) / 1000, 0.1) : 0;
    this.lastFrame = time;
    const now = performance.now();

    if (this.playing) {
      this.angle += this.speed * Math.PI * 2 * delta;
      if (this.angle > Math.PI * 2) this.angle -= Math.PI * 2;
      const current = this.ctx.currentTime;
      const radius = 1.6;
      this.panner.positionX.setTargetAtTime(Math.sin(this.angle) * radius, current, 0.05);
      this.panner.positionZ.setTargetAtTime(Math.cos(this.angle) * radius, current, 0.05);
      this.panner.positionY.setTargetAtTime(Math.sin(this.angle * 2) * 0.2, current, 0.05);
      const previewFactor = this.previewMode ? 0.5 : 1;
      this.stereoPanner.pan.setTargetAtTime(
        Math.sin(this.angle) * clamp(this.depth * 1.15 * previewFactor, 0, 1),
        current,
        0.06,
      );
    }

    if (this.analyser && now - this._lastLevelRead > (this.playing ? 110 : 420)) {
      this._readLevels();
      this._lastLevelRead = now;

      if (this.smart && this.playing && !this.previewMode && now - this._lastSmart > 420) {
        const correlation = this._correlation();
        const target = this.baseDepth * (0.8 + 0.2 * ((correlation + 1) / 2));
        this.smartDepth += (target - this.smartDepth) * 0.22;
        this.depth = this.smartDepth;
        this._applySpace();
        this._lastSmart = now;
      }

      if (this.autolevel && this.playing && !this.previewMode && this.levelDb > -52) {
        if (now - this._lastAdjust > 240) {
          const error = -17 - this.levelDb;
          const step = clamp(error * 0.08, -0.3, 0.3);
          this.levelGainDb = clamp(this.levelGainDb + step, -9, 7);
          this.preGain.gain.setTargetAtTime(
            Math.pow(10, this.levelGainDb / 20),
            this.ctx.currentTime,
            0.35,
          );
          this._lastAdjust = now;
        }
      }
    }

    const paintInterval = this.playing ? 33 : 150;
    if (this._loopCallback && now - this._lastPaint >= paintInterval) {
      this._lastPaint = now;
      this._loopCallback({
        angle: this.angle,
        spectrum: this.freqData,
        levelDb: this.levelDb,
        levelDbL: this.levelDbL,
        levelDbR: this.levelDbR,
        playing: this.playing,
        depth: this.depth,
      });
    }

    this._raf = requestAnimationFrame((next) => this._loopTick(next));
  }
}
