import { clamp } from './util.js';

export class OrbitView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.size = 0;
    this.dpr = 1;
    this.prev = new Float32Array(72);
    this.lastDraw = 0;
    this._observer = new ResizeObserver(() => this.resize());
    this._observer.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const size = Math.max(120, Math.round(Math.min(rect.width, rect.height) || 260));
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    if (size === this.size && dpr === this.dpr) return;
    this.size = size;
    this.dpr = dpr;
    this.canvas.width = Math.round(size * dpr);
    this.canvas.height = Math.round(size * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(frame) {
    const now = performance.now();
    const motion = document.documentElement.dataset.motion;
    let gap = frame.playing ? 34 : 180;
    if (motion === 'none') gap = 300;
    else if (motion === 'reduced') gap = 90;
    if (now - this.lastDraw < gap) return;
    this.lastDraw = now;

    const ctx = this.ctx;
    const size = this.size;
    const center = size / 2;
    const depth = clamp(Number(frame.depth) || 0, 0, 1);
    const spectrum = frame.spectrum;
    const bins = spectrum ? spectrum.length : 0;

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.translate(center, center);

    ctx.strokeStyle = 'rgba(255,255,255,0.075)';
    ctx.lineWidth = 1;
    ctx.setLineDash([1.5, 5]);
    for (const radius of [0.3, 0.398, 0.468]) {
      ctx.beginPath();
      ctx.arc(0, 0, size * radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    for (let index = 0; index < 36; index += 1) {
      const angle = (index / 36) * Math.PI * 2 - Math.PI / 2;
      const long = index % 4 === 0;
      const inner = size * (long ? 0.485 : 0.492);
      const outer = size * 0.505;
      ctx.globalAlpha = long ? 0.5 : 0.22;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const bars = 56;
    const base = size * 0.315;
    const maxLength = size * 0.14;
    for (let index = 0; index < bars; index += 1) {
      const t = index / (bars - 1);
      const bin = bins ? Math.floor(Math.pow(t, 1.55) * bins * 0.62) : 0;
      const raw = bins ? spectrum[bin] / 255 : 0;
      const value = this.prev[index] * 0.55 + raw * 0.45;
      this.prev[index] = value;
      const angle = (index / bars) * Math.PI * 2 - Math.PI / 2;
      const start = base;
      const end = base + 3 + value * maxLength;
      const color = index % 3 === 0 ? '133, 238, 255' : '255, 95, 225';
      ctx.strokeStyle = `rgba(${color}, ${0.08 + value * 0.55})`;
      ctx.lineWidth = 1.7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * start, Math.sin(angle) * start);
      ctx.lineTo(Math.cos(angle) * end, Math.sin(angle) * end);
      ctx.stroke();
    }

    const angle = Number(frame.angle) || 0;
    const radius = size * 0.358;

    for (let index = 0; index < 12; index += 1) {
      const trailAngle = angle - index * 0.055;
      const alpha = (1 - index / 12) * 0.32 * Math.max(depth, 0.12);
      ctx.strokeStyle = `rgba(133, 238, 255, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, radius, trailAngle - 0.014, trailAngle + 0.014);
      ctx.stroke();
    }

    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    ctx.fillStyle = depth > 0.04 ? 'rgba(255, 170, 250, 0.98)' : 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(x, y, 2.2 + depth * 1.9, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    void frame.levelDb;
  }
}
