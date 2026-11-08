import { api } from './api.js';

export const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });

export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function fmtTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export function fmtCount(value) {
  const number = Number(value) || 0;
  if (number >= 1_000_000) {
    return `${(number / 1_000_000).toFixed(1).replace('.', ',')} Mn`;
  }
  if (number >= 1_000) {
    const thousands = number / 1_000;
    return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1).replace('.', ',')} B`;
  }
  return String(number);
}

export function fmtDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('tr-TR', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function timeAgo(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp || 0)) / 1000));
  if (seconds < 60) return 'az önce';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} dk`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} gün`;
  return fmtDate(timestamp);
}

export function hueFor(value) {
  const input = String(value ?? '');
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) % 360;
  }
  return hash;
}

export function initials(name) {
  const parts = String(name || '?')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toLocaleUpperCase('tr-TR');
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toLocaleUpperCase('tr-TR');
}

export function image(url, className = '', alt = '') {
  if (!url) return '';
  return `<img class="${className}" src="${api.img(url)}" alt="${esc(alt)}" loading="lazy" decoding="async">`;
}

export function artBox(url, className = '', alt = '', fallback = '') {
  const inner = url
    ? image(url, '', alt)
    : `<span class="avatarfallback" aria-hidden="true">${esc(fallback || '♪')}</span>`;
  return `<span class="${className}">${inner}</span>`;
}

export const verifiedMark = (entity, label = 'Doğrulanmış sanatçı') =>
  entity && entity.verified
    ? `<span class="vbadge" title="${esc(label)}" role="img" aria-label="${esc(label)}"><svg class="i"><use href="#i-check"/></svg></span>`
    : '';

export const icon = (name) => `<svg class="i" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export function debounce(fn, wait = 220) {
  let timer = 0;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

export const isUrlLike = (value) => /^(https?:\/\/|www\.)/i.test(String(value || '').trim());

export function genreLabel(genre) {
  const labels = {
    Electronic: 'Elektronik',
    'Hip-Hop/Rap': 'Hip-Hop',
    'R&B/Soul': 'R&B',
    Alternative: 'Alternatif',
    Techno: 'Tekno',
    Jazz: 'Caz',
    Classical: 'Klasik',
    'Drum & Bass': 'Drum & Bass',
    'Lo-Fi': 'Lo-Fi',
  };
  return labels[genre] || genre || 'Diğer';
}
