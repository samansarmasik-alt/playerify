import { esc, icon, image } from './util.js';

let activeOverlay = null;
let restoreFocus = null;
let trapHandler = null;

export function isModalOpen() {
  return Boolean(activeOverlay);
}

export function openModal(html, options = {}) {
  closeModal();
  restoreFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.dataset.overlay = 'modal';
  overlay.innerHTML = `<div class="modal${options.wide ? ' modal--wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(options.label || 'Pencere')}">${html}</div>`;
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeModal();
  });

  trapHandler = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = overlay.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  document.addEventListener('keydown', trapHandler, true);
  document.getElementById('overlayRoot').appendChild(overlay);
  activeOverlay = overlay;

  requestAnimationFrame(() => {
    const target = overlay.querySelector('input, button, a[href]');
    if (target) target.focus();
  });
  return overlay;
}

export function closeModal() {
  if (!activeOverlay) return;
  if (trapHandler) {
    document.removeEventListener('keydown', trapHandler, true);
    trapHandler = null;
  }
  activeOverlay.remove();
  activeOverlay = null;
  if (restoreFocus && typeof restoreFocus.focus === 'function') {
    restoreFocus.focus({ preventScroll: true });
  }
  restoreFocus = null;
}

export function toast(message, kind = 'ok') {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const element = document.createElement('div');
  element.className = `toast${kind === 'error' ? ' toast--error' : ''}`;
  element.innerHTML = `${icon(kind === 'error' ? 'x' : 'check')}<span>${esc(message)}</span>`;
  root.appendChild(element);
  window.setTimeout(() => {
    element.classList.add('is-out');
    window.setTimeout(() => element.remove(), 240);
  }, 3400);
}

export function openEmbed(result) {
  const platform = result.kind === 'spotify' ? 'Spotify' : 'YouTube';
  const subtitle =
    result.kind === 'youtube'
      ? result.author
      : result.kind === 'youtube_playlist'
        ? 'Resmi YouTube liste oynatıcısı'
        : 'Spotify gömülü oynatıcı';
  return openModal(
    `<div class="modal__head">
      <span class="modal__title">Gömülü oynatım</span>
      <button class="iconbtn" data-act="close-overlay" aria-label="Kapat">${icon('x')}</button>
    </div>
    <div class="modal__body">
      <div class="embedframe">
        <iframe src="${esc(result.embed)}" title="${esc(result.title)}" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
      </div>
      <div class="linkcard">
        ${image(result.thumbnail, '', result.title)}
        <div class="linkcard__meta">
          <div class="linkcard__title">${esc(result.title)}</div>
          <div class="linkcard__sub">${platform} · ${esc(subtitle || '')}</div>
        </div>
      </div>
      <div class="note">${icon('spark')}<span>${
        result.kind === 'youtube_playlist'
          ? 'Liste, resmi YouTube oynatıcısıyla tam olarak çalar. Ses YouTube tarafında kalır; 8D motoru ve EQ zinciri devre dışı. Reklam ve bölge kısıtları YouTube tarafından uygulanır.'
          : `Gömülü oynatımda Playerify'ın 8D motoru ve EQ zinciri devre dışı: platform sesi kendi oynatıcısında kalıyor. Reklam ve bölge kısıtları ${platform} tarafından uygulanır. Tam kontrol için aynı kaydı Playerify kataloğunda aratabilirsin.`
      }</span></div>
      <div class="modal__foot" style="border:0;padding:14px 0 0">
        ${
          result.kind === 'youtube_playlist'
            ? ''
            : `<button class="btn btn--glass" data-act="find-on-playerify" data-query="${esc(result.title)}">${icon('search')} Playerify'da ara</button>`
        }
        ${
          result.url
            ? `<a class="btn btn--glass" href="${esc(result.url)}" target="_blank" rel="noopener noreferrer">${icon('external')} ${platform}'da aç</a>`
            : ''
        }
        <button class="btn btn--ghost" data-act="close-overlay">Kapat</button>
      </div>
    </div>`,
    { wide: true, label: 'Gömülü oynatım' },
  );
}

export function openLinkDialog(value = '') {
  return openModal(
    `<div class="modal__head">
      <span class="modal__title">Bağlantıdan aç</span>
      <button class="iconbtn" data-act="close-overlay" aria-label="Kapat">${icon('x')}</button>
    </div>
    <div class="modal__body">
      <div class="field">
        <span>Spotify, YouTube (tek şarkı/liste) ya da Audius bağlantısı</span>
        <input class="input" id="linkInput" value="${esc(value)}" placeholder="https://open.spotify.com/track/…" spellcheck="false" autocomplete="off">
      </div>
      <div class="note">${icon('link')}<span>Audius ve YouTube bağlantıları doğrudan tam uzunlukta çalar. Spotify, Apple Music ve Deezer bağlantıları çözümlenir; şarkı Audius veya YouTube'da bulunursa kendi çalarımızda 8D ve EQ zinciriyle açılır. Yalnızca liste/albüm bağlantıları resmî gömülü oynatıcıya düşer.</span></div>
      <div class="modal__foot" style="border:0;padding:14px 0 0">
        <button class="btn btn--glass" data-act="resolve-link">${icon('link')} Çözümle</button>
        <button class="btn btn--ghost" data-act="close-overlay">Vazgeç</button>
      </div>
    </div>`,
    { label: 'Bağlantıdan aç' },
  );
}
