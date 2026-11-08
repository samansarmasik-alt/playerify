import { isLiked, library, playback, settings, ui } from './store.js';
import {
  artBox,
  esc,
  fmtCount,
  fmtDate,
  fmtTime,
  genreLabel,
  hueFor,
  icon,
  image,
  initials,
  timeAgo,
  verifiedMark,
} from './util.js';

export const lists = {
  featured: [],
  trending: [],
  monthly: [],
  artistShelf: [],
  search: [],
  searchArtists: [],
  searchPlaylists: [],
  matches: [],
  artist: [],
  playlist: [],
  liked: [],
  recent: [],
  genre: [],
  queue: [],
};

function resetLists() {
  for (const key of Object.keys(lists)) lists[key] = [];
}

function visibleTracks(tracks) {
  const items = (Array.isArray(tracks) ? tracks : []).filter(
    (track) => track.playable !== false && !track.preview,
  );
  if (!settings.verifiedOnly) return items;
  return items.filter((track) => track.source !== 'audius' || track.verified);
}

function visibleArtists(artists) {
  const items = Array.isArray(artists) ? artists : [];
  return settings.verifiedOnly ? items.filter((artist) => artist.verified) : items;
}

function sectionHead(title, sub = '', link = '') {
  return `<div class="section__head">
    <div>
      <h2 class="section__title">${esc(title)}</h2>
      ${sub ? `<p class="section__sub">${esc(sub)}</p>` : ''}
    </div>
    ${link || ''}
  </div>`;
}

function trackTile(track, listName, index = 0) {
  const external = track.external || '';
  const provider = track.source && track.source !== 'audius';
  const source = provider
    ? `<span class="tile__source">${esc(track.sourceLabel || 'Katalog')}${track.preview ? ' · 30 sn' : ''}</span>`
    : '';
  const playable = track.playable !== false;
  const playControl = playable
    ? `<button class="tile__play" data-act="play-track" data-id="${esc(track.id)}" data-list="${listName}" data-index="${index}" aria-label="${esc(track.title)} çal">${icon('play')}</button>`
    : external
      ? `<a class="tile__play" href="${esc(external)}" target="_blank" rel="noopener noreferrer" aria-label="Kaynağı aç">${icon('external')}</a>`
      : '';
  const artist = track.artist
    ? track.artist.id && !provider
      ? `<button data-act="artist" data-id="${esc(track.artist.id)}">${esc(track.artist.name)}</button>`
      : `<span>${esc(track.artist.name)}</span>`
    : '<span>Bilinmeyen</span>';
  const title = playable
    ? `<button class="tile__title" data-act="play-track" data-id="${esc(track.id)}" data-list="${listName}" data-index="${index}">${esc(track.title)}</button>`
    : `<div class="tile__title">${esc(track.title)}</div>`;
  return `<div class="tile" style="--hue:${hueFor(track.id)}">
    <div class="tile__art">
      ${image(track.art, '', track.title)}
      ${source}
      ${playControl}
    </div>
    ${title}
    <div class="tile__meta">
      ${verifiedMark(track)}
      ${artist}
    </div>
  </div>`;
}

function artistTile(artist) {
  return `<a class="tile tile--artist" href="#/artist/${esc(artist.id)}" style="--hue:${hueFor(artist.id)}">
    <div class="tile__art">${image(artist.avatar, '', artist.name)}</div>
    <div class="tile__title">${esc(artist.name)}</div>
    <div class="tile__meta">${verifiedMark(artist)}<span>${fmtCount(artist.followers)} takipçi</span></div>
  </a>`;
}

function playlistCard(playlist) {
  return `<a class="pcard" href="#/playlist/${esc(playlist.id)}" style="--hue:${hueFor(playlist.id)}">
    <span class="pcard__art">${image(playlist.artSm || playlist.art, '', playlist.name)}</span>
    <span class="pcard__meta">
      <span class="pcard__title">${esc(playlist.name)}</span>
      <span class="pcard__sub">${playlist.isAlbum ? 'Albüm' : 'Liste'} · ${fmtCount(playlist.trackCount)} parça</span>
    </span>
  </a>`;
}

export function trackRow(track, index, listName, options = {}) {
  const liked = isLiked(track.id);
  const active = playback.current && playback.current.id === track.id;
  const removable = Boolean(options.removable);
  const external = track.external || '';
  const provider = track.source && track.source !== 'audius';
  const playable = track.playable !== false;
  const source = provider
    ? external
      ? `<a class="sourcepill sourcepill--${esc(track.source)}" href="${esc(external)}" target="_blank" rel="noopener noreferrer" title="${esc(track.sourceLabel || '')} · resmi katalog">${esc(track.sourceLabel || 'Katalog')}${track.preview ? ' · 30 sn' : ''}</a>`
      : `<span class="sourcepill sourcepill--${esc(track.source)}">${esc(track.sourceLabel || 'Katalog')}${track.preview ? ' · 30 sn' : ''}</span>`
    : '';
  const playControl = playable
    ? `<button class="row__play" data-act="play-track" data-id="${esc(track.id)}" data-list="${listName}" data-index="${index}" aria-label="${esc(track.title)} çal">${icon('play')}</button>`
    : external
      ? `<a class="row__play" href="${esc(external)}" target="_blank" rel="noopener noreferrer" aria-label="Kaynağı aç">${icon('external')}</a>`
      : '';
  const artist = track.artist
    ? track.artist.id && !provider
      ? `<button data-act="artist" data-id="${esc(track.artist.id)}">${esc(track.artist.name)}</button>`
      : `<span>${esc(track.artist.name)}</span>`
    : '<span>Bilinmeyen sanatçı</span>';
  return `<div class="row${active ? ' is-active' : ''}" data-row-id="${esc(track.id)}" style="--hue:${hueFor(track.id)}">
    <div class="row__index">
      <span class="row__num">${String(index + 1).padStart(2, '0')}</span>
      <span class="row__eq" aria-hidden="true"><i class="eqbar"></i><i class="eqbar"></i><i class="eqbar"></i></span>
    </div>
    <div class="row__art">
      ${image(track.artSm || track.art, '', track.title)}
      ${playControl}
    </div>
    <div class="row__meta">
      <div class="row__title">
        <span>${esc(track.title)}</span>
        ${verifiedMark(track)}
        ${source}
      </div>
      <div class="row__artist">
        ${artist}
      </div>
    </div>
    <span class="row__genre">${esc(track.genre ? genreLabel(track.genre) : '—')}</span>
    <span class="row__dur">${fmtTime(track.duration)}</span>
    <button class="iconbtn row__like" data-act="toggle-like" data-id="${esc(track.id)}" aria-pressed="${liked}" aria-label="${liked ? 'Beğeniden çıkar' : 'Beğen'}">${icon('heart')}</button>
    ${
      removable
        ? `<button class="iconbtn row__add" data-act="playlist-remove" data-id="${esc(track.id)}" aria-label="Listeden çıkar">${icon('x')}</button>`
        : `<button class="iconbtn row__add" data-act="queue-add" data-id="${esc(track.id)}" aria-label="Kuyruğa ekle">${icon('plus')}</button>`
    }
  </div>`;
}

export function hero(track) {
  if (!track) return '';
  const stats = [];
  if (track.genre) stats.push(`<span>${esc(genreLabel(track.genre))}</span>`);
  if (track.bpm) stats.push(`<span><b>${Math.round(track.bpm)}</b> BPM</span>`);
  if (track.key) stats.push(`<span><b>${esc(track.key)}</b></span>`);
  if (track.duration) stats.push(`<span><b>${fmtTime(track.duration)}</b></span>`);
  if (track.plays) stats.push(`<span><b>${fmtCount(track.plays)}</b> dinleme</span>`);
  const liked = isLiked(track.id);
  return `<section class="hero" style="--hue:${hueFor(track.id)}">
    ${track.art ? `<div class="hero__bg" aria-hidden="true">${image(track.art, '', '')}</div>` : ''}
    <div class="hero__main">
      <div class="hero__kicker">
        <span class="eyebrow">Günün kaydı</span>
        ${track.verified ? `<span class="hero__badge">${icon('check')} Doğrulanmış sanatçı</span>` : ''}
        <span class="hero__badge">${icon('spark')} Akıllı motor</span>
      </div>
      <h2 class="hero__title">${esc(track.title)}</h2>
      <div class="hero__artist">
        ${track.artist ? `<button data-act="artist" data-id="${esc(track.artist.id)}">${esc(track.artist.name)}</button>` : ''}
        ${verifiedMark(track)}
      </div>
      <div class="hero__stats">${stats.join('')}</div>
      <div class="hero__actions">
        <button class="btn btn--primary" data-act="play-track" data-id="${esc(track.id)}" data-list="featured" data-index="0">${icon('play')} Dinle</button>
        <button class="btn btn--glass" data-act="play-smart" data-id="${esc(track.id)}" data-list="featured" data-index="0">${icon('spark')} Akıllı çal</button>
        <button class="iconbtn" data-act="toggle-like" data-id="${esc(track.id)}" aria-pressed="${liked}" aria-label="${liked ? 'Beğeniden çıkar' : 'Beğen'}">${icon('heart')}</button>
        <button class="iconbtn" data-act="queue-add" data-id="${esc(track.id)}" aria-label="Kuyruğa ekle">${icon('plus')}</button>
      </div>
    </div>
    <div class="hero__art-wrap">
      <figure class="hero__art">
        ${image(track.art, '', track.title)}
        <span class="hero__artnum">Audius · ${track.released ? esc(String(new Date(track.released).getFullYear())) : 'kayıt'}</span>
      </figure>
    </div>
  </section>`;
}

export function renderHome(data) {
  resetLists();
  const trending = visibleTracks(data.trending);
  const monthly = visibleTracks(data.monthly);
  const playlists = data.playlists || [];
  const artists = visibleArtists(data.artists);

  const featured = trending.find((track) => track.verified && track.duration > 60) || trending[0] || monthly[0] || null;
  const recent = library.recent
    .filter((track) => track && track.id && track.source !== 'local')
    .slice(0, 8);
  lists.featured = featured ? [featured] : [];
  lists.trending = trending;
  lists.monthly = monthly;
  lists.recent = recent;

  const genreLinks = (data.genres || [])
    .map((genre, index) => {
      const label = genreLabel(genre);
      return `<a class="genre" href="#/genre/${encodeURIComponent(genre)}">
        <span class="genre__num">${String(index + 1).padStart(2, '0')}</span>
        <span class="genre__name">${esc(label)}</span>
        <span class="genre__arrow">${icon('arrow')}</span>
      </a>`;
    })
    .join('');

  const empty = !trending.length && !monthly.length && !playlists.length;

  return `${hero(featured)}
    ${empty ? emptyState('Katalog sessiz', 'Audius şu anda yanıt vermiyor. Birkaç saniye sonra yeniden dene.', 'Yenile', 'retry') : ''}
    ${
      recent.length
        ? `<section class="section section--recent">
            ${sectionHead('Kaldığın yerden', 'Son çaldığın kayıtlar', `<a class="section__link" href="#/library">Kitaplık ${icon('arrow')}</a>`)}
            <div class="shelf">${recent.map((track, index) => trackTile(track, 'recent', index)).join('')}</div>
          </section>`
        : ''
    }
    ${
      trending.length
        ? `<section class="section">
            ${sectionHead('Şu an yükselen', 'Audius haftalık trendleri · gerçek dinlemeler', `<a class="section__link" href="#/genre/Electronic">Sahnelere bak ${icon('arrow')}</a>`)}
            <div class="shelf">
              ${trending.map((track, index) => trackTile(track, 'trending', index)).join('')}
            </div>
          </section>`
        : ''
    }
    <div class="split">
      <section class="section">
        ${sectionHead('Bu ayın derinliği', 'Daha az bilinen, daha uzun kuyruk')}
        <div class="rows">
          ${monthly.slice(0, 10).map((track, index) => trackRow(track, index, 'monthly')).join('')}
        </div>
      </section>
      <section class="section">
        ${sectionHead('Uzun çalma', 'Küratörlerin listeleri')}
        <div class="stack">${playlists.slice(0, 6).map(playlistCard).join('')}</div>
        ${
          artists.length
            ? `<div class="sideblock">
                ${sectionHead('Sanatçılar')}
                ${artists.slice(0, 4).map((artist) => `<a class="acard" href="#/artist/${esc(artist.id)}" style="--hue:${hueFor(artist.id)}">
                  <span class="acard__art">${image(artist.avatar, '', artist.name)}</span>
                  <span class="acard__meta">
                    <span class="acard__name">${esc(artist.name)}${verifiedMark(artist)}</span>
                    <span class="acard__sub">${fmtCount(artist.followers)} takipçi</span>
                  </span>
                </a>`).join('')}
              </div>`
            : ''
        }
      </section>
    </div>
    ${
      genreLinks
        ? `<section class="section">
            ${sectionHead('Sahneler', 'Türe göre trendleri aç')}
            <div class="genres">${genreLinks}</div>
          </section>`
        : ''
    }`;
}

export function searchShell(query) {
  return `<section class="searchhead">
    <div class="searchfield">
      ${icon('search')}
      <input id="searchInput" type="search" value="${esc(query)}" placeholder="Parça, sanatçı ya da liste ara" autocomplete="off" spellcheck="false" enterkeyhint="search" aria-label="Ara">
      <kbd>↵</kbd>
      <button class="searchfield__link" data-act="paste-link" aria-label="Bağlantıdan aç" title="Spotify, YouTube veya Audius bağlantısı yapıştır">${icon('link')}</button>
    </div>
  </section>
  <div id="searchResults" aria-live="polite"></div>`;
}

export function searchLead() {
  const genres = ['Electronic', 'Hip-Hop/Rap', 'Lo-Fi', 'House', 'Drum & Bass', 'Ambient'];
  return `<div class="searchlead">
    <h2 class="searchlead__title">Katalogda ne arıyorsun?</h2>
    <p class="searchlead__sub">Audius tam kayıtları, YouTube sonuçları ve kendi dosyaların. Büyük/küçük harf ve yazım hataları sorun değil; yakın eşleşmeleri de bulurum. Spotify veya YouTube bağlantısı yapıştırırsan şarkıyı Audius'ta ve YouTube'da arar, bulduğumu çalarımda açarım.</p>
    <div class="suggestions">
      ${genres.map((genre) => `<a class="chip" href="#/genre/${encodeURIComponent(genre)}">${esc(genreLabel(genre))}</a>`).join('')}
      <button class="chip" data-act="paste-link">${icon('link')} Bağlantı</button>
      <button class="chip" data-act="open-files">${icon('disc')} Dosya aç</button>
    </div>
  </div>`;
}

function matchRow(matches) {
  if (!Array.isArray(matches) || matches.length < 2) return '';
  return `<div class="matchrow">
    <div class="matchrow__head">
      <span class="eyebrow">Hangi kayıt?</span>
      <span class="mono dim">${matches.length} eşleşme</span>
    </div>
    <div class="matchrow__items">
      ${matches
        .map(
          (track) => `<button class="matchcard" data-act="play-track" data-id="${esc(track.id)}" data-list="matches" style="--hue:${hueFor(track.id)}">
            <span class="matchcard__art">${image(track.artSm || track.art, '', track.title)}</span>
            <span class="matchcard__meta">
              <span class="matchcard__title">${esc(track.title)}</span>
              <span class="matchcard__artist">${esc(track.artist ? track.artist.name : '')}</span>
              <span class="matchcard__source">${esc(track.sourceLabel || '')}${track.preview ? ' · 30 sn' : ''}</span>
            </span>
            <span class="matchcard__play">${icon('play')}</span>
          </button>`,
        )
        .join('')}
    </div>
  </div>`;
}

function searchTop(track) {
  const liked = isLiked(track.id);
  const provider = track.source && track.source !== 'audius';
  const source = provider
    ? `${track.sourceLabel || 'Katalog'}${track.preview ? ' · 30 sn resmi önizleme' : ''}`
    : 'Audius · tam uzunlukta';
  const meta = [
    track.album,
    track.released ? new Date(track.released).getFullYear() : '',
    track.preview
      ? `0:30 önizleme · orijinal ${fmtTime(track.fullDuration || track.duration)}`
      : track.duration
        ? fmtTime(track.duration)
        : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const playable = track.playable !== false;
  return `<div class="topresult" style="--hue:${hueFor(track.id)}">
    <div class="topresult__art">${image(track.art, '', track.title)}</div>
    <div class="topresult__meta">
      <div class="eyebrow">En iyi eşleşme</div>
      <h3 class="topresult__title">${esc(track.title)}</h3>
      <div class="topresult__artist">${verifiedMark(track)}<span>${esc(track.artist ? track.artist.name : '')}</span></div>
      <div class="topresult__sub">${esc(meta)}${meta ? ' · ' : ''}${esc(source)}</div>
    </div>
    <div class="topresult__actions">
      ${
        playable
          ? `<button class="btn btn--primary btn--sm" data-act="play-track" data-id="${esc(track.id)}" data-list="search">${icon('play')} ${track.preview ? 'Önizlemeyi çal' : 'Çal'}</button>`
          : track.external
            ? `<a class="btn btn--glass btn--sm" href="${esc(track.external)}" target="_blank" rel="noopener noreferrer">${icon('external')} Kaynağı aç</a>`
            : ''
      }
      ${track.external ? `<a class="btn btn--ghost btn--sm" href="${esc(track.external)}" target="_blank" rel="noopener noreferrer">${icon('external')} ${track.preview ? 'Tam sürümü aç' : esc(track.sourceLabel || 'Kaynak')}</a>` : ''}
      <button class="iconbtn" data-act="toggle-like" data-id="${esc(track.id)}" aria-pressed="${liked}" aria-label="${liked ? 'Beğeniden çıkar' : 'Beğen'}">${icon('heart')}</button>
    </div>
  </div>`;
}

export function searchResults(data) {
  const query = data.query || '';
  const allTracks = (data.tracks || []).filter(
    (track) => track.playable !== false && !track.preview,
  );
  let tracks = visibleTracks(data.tracks);
  const hiddenByVerified =
    settings.verifiedOnly && tracks.length === 0 && allTracks.length > 0;
  if (hiddenByVerified) tracks = allTracks;
  const artists = visibleArtists(data.artists);
  const playlists = data.playlists || [];
  const providers = data.providers || {};
  const providerText = [
    providers.audius ? `Audius ${providers.audius}` : '',
    providers.youtube ? `YouTube ${providers.youtube}` : '',
    providers.itunes ? `Apple ${providers.itunes}` : '',
    providers.deezer ? `Deezer ${providers.deezer}` : '',
    providers.spotify ? `Spotify ${providers.spotify}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const matches = Array.isArray(data.matches) ? data.matches : [];
  const suggestion =
    data.suggestion && data.suggestion.query
      ? `<button class="suggestionchip" data-act="search-suggestion" data-query="${esc(data.suggestion.query)}">
          ${icon('spark')}<span>Bunu mu demek istedin?</span><b>${esc(data.suggestion.label || data.suggestion.query)}</b>
        </button>`
      : '';
  lists.search = tracks;
  lists.searchArtists = artists;
  lists.searchPlaylists = playlists;
  lists.matches = matches;

  if (!tracks.length && !artists.length && !playlists.length) {
    return `${tabs(0, 0, 0, providerText)}
      ${suggestion}
      ${emptyState('Bu aramada tam kayıt yok', `"${query}" için Audius ve YouTube'da eşleşen kayıt bulunamadı. 30 saniyelik önizleme kapalı; kendi dosyanı açarsan tam kalitede ve 8D zinciriyle çalar.`, 'Dosya aç', 'open-files')}`;
  }

  const tab = ui.tab;
  const showTracks = tab === 'all' || tab === 'tracks';
  const showArtists = tab === 'all' || tab === 'artists';
  const showPlaylists = tab === 'all' || tab === 'playlists';

  let main = '';
  if (showTracks && tracks.length) {
    main = `<div class="rows">${tracks.map((track, index) => trackRow(track, index, 'search')).join('')}</div>`;
  } else if (showArtists) {
    main = artists.length
      ? `<div class="stack">${artists.map((artist) => `<a class="acard" href="#/artist/${esc(artist.id)}" style="--hue:${hueFor(artist.id)}">
          <span class="acard__art">${image(artist.avatar, '', artist.name)}</span>
          <span class="acard__meta">
            <span class="acard__name">${esc(artist.name)}${verifiedMark(artist)}</span>
            <span class="acard__sub">${fmtCount(artist.followers)} takipçi · ${fmtCount(artist.tracks)} parça</span>
          </span>
        </a>`).join('')}</div>`
      : emptyState('Sanatçı bulunamadı', 'Bu sorguda eşleşen bir sanatçı profili yok.');
  } else if (showPlaylists) {
    main = playlists.length
      ? `<div class="stack">${playlists.map(playlistCard).join('')}</div>`
      : emptyState('Liste bulunamadı', 'Bu sorguda eşleşen bir liste yok.');
  } else {
    main = emptyState('Bu sekme boş', 'Diğer sekmelerde sonuç olabilir.');
  }

  const side =
    tab === 'all'
      ? `<aside>
          ${
            artists.length
              ? `<div class="sideblock">
                  <div class="sideblock__title">Sanatçılar <span>${artists.length}</span></div>
                  <div class="stack">${artists.slice(0, 6).map((artist) => `<a class="acard" href="#/artist/${esc(artist.id)}" style="--hue:${hueFor(artist.id)}">
                    <span class="acard__art">${image(artist.avatar, '', artist.name)}</span>
                    <span class="acard__meta">
                      <span class="acard__name">${esc(artist.name)}${verifiedMark(artist)}</span>
                      <span class="acard__sub">${fmtCount(artist.followers)} takipçi</span>
                    </span>
                  </a>`).join('')}</div>
                </div>`
              : ''
          }
          ${
            playlists.length
              ? `<div class="sideblock">
                  <div class="sideblock__title">Listeler <span>${playlists.length}</span></div>
                  <div class="stack">${playlists.slice(0, 6).map(playlistCard).join('')}</div>
                </div>`
              : ''
          }
        </aside>`
      : '';

  const verifiedNote = hiddenByVerified
    ? `<div class="note" style="margin:8px 2px 12px">${icon('check')}<span>Doğrulanmış filtresi açık; bu aramada doğrulanmış sonuç yok. Tüm tam kayıtlar gösteriliyor.</span></div>`
    : '';
  const youtubeNote = providers.youtube
    ? `<div class="note" style="margin:8px 2px 12px">${icon('spark')}<span>YouTube sonuçları Playerify çalarında 8D ve EQ zinciriyle tam kayıt olarak çalar; ses çıkarılamazsa resmî gömülü oynatıcıya geçilir.</span></div>`
    : '';

  return `${tabs(tracks.length, artists.length, playlists.length, providerText)}
    ${suggestion}
    ${verifiedNote}
    ${youtubeNote}
    ${tab === 'all' ? matchRow(matches) : ''}
    ${tab === 'all' && tracks.length ? searchTop(tracks[0]) : ''}
    <div class="searchgrid">
      ${main}
      ${side}
    </div>`;
}

function tabs(trackCount, artistCount, playlistCount, providerText = '') {
  const item = (id, label, count) =>
    `<button class="chip${ui.tab === id ? ' is-on' : ''}" data-act="search-tab" data-tab="${id}" aria-pressed="${ui.tab === id}">${label}${count !== null ? ` · ${count}` : ''}</button>`;
  return `<div class="searchmeta">
    <div class="searchtabs">
      ${item('all', 'Tümü', trackCount + artistCount + playlistCount)}
      ${item('tracks', 'Parçalar', trackCount)}
      ${item('artists', 'Sanatçılar', artistCount)}
      ${item('playlists', 'Listeler', playlistCount)}
    </div>
    <span class="mono dim">${esc(providerText || 'Katalog')}</span>
  </div>`;
}

export function renderArtist(data, sort = 'plays') {
  resetLists();
  const artist = data.artist || {};
  const tracks = data.tracks || [];
  lists.artist = tracks;

  return `<a class="backbtn" href="#/discover">${icon('arrow')} Keşfet</a>
    <header class="artisthead" style="--hue:${hueFor(artist.id)}">
      ${artist.cover ? `<div class="artisthead__cover" style="background-image:url('${esc(`/api/img?u=${encodeURIComponent(artist.cover)}`)}')"></div>` : ''}
      <div class="artisthead__avatar">${image(artist.avatar, '', artist.name)}</div>
      <div class="artisthead__body">
        <div class="eyebrow">Sanatçı</div>
        <h2 class="artisthead__name">${esc(artist.name)}${verifiedMark(artist)}</h2>
        ${artist.bio ? `<p class="artisthead__bio">${esc(artist.bio)}</p>` : ''}
        <div class="artisthead__stats">
          <div class="artisthead__stat"><b>${fmtCount(artist.followers)}</b><span>takipçi</span></div>
          <div class="artisthead__stat"><b>${fmtCount(artist.tracks)}</b><span>parça</span></div>
          ${artist.location ? `<div class="artisthead__stat"><b>${esc(artist.location)}</b><span>konum</span></div>` : ''}
        </div>
        <div class="artisthead__actions">
          <button class="btn btn--primary" data-act="play-list" data-list="artist" data-index="0" ${tracks.length ? '' : 'disabled'}>${icon('play')} En iyileri çal</button>
          <button class="btn btn--glass" data-act="shuffle-list" data-list="artist" ${tracks.length ? '' : 'disabled'}>${icon('shuffle')} Karıştır</button>
        </div>
      </div>
    </header>
    <section class="section">
      <div class="section__head">
        <div>
          <h2 class="section__title">Kayıtlar</h2>
          <p class="section__sub">${sort === 'date' ? 'En yeni yüklemeler' : 'Dinlenme sayısına göre'}</p>
        </div>
        <div class="seg">
          <button data-act="artist-sort" data-sort="plays" aria-pressed="${sort !== 'date'}">Popüler</button>
          <button data-act="artist-sort" data-sort="date" aria-pressed="${sort === 'date'}">Yeni</button>
        </div>
      </div>
      ${
        tracks.length
          ? `<div class="rows">${tracks.map((track, index) => trackRow(track, index, 'artist')).join('')}</div>`
          : emptyState('Parça yok', 'Bu sanatçının katalogda görünen bir kaydı yok.')
      }
    </section>`;
}

export function renderPlaylist(data) {
  resetLists();
  const playlist = data.playlist || {};
  const tracks = data.tracks || [];
  lists.playlist = tracks;

  return `<a class="backbtn" href="#/library">${icon('arrow')} Kitaplık</a>
    <header class="playlisthead" style="--hue:${hueFor(playlist.id)}">
      <div class="playlisthead__art">${image(playlist.art || playlist.artSm, '', playlist.name)}</div>
      <div class="playlisthead__body">
        <div class="eyebrow">${playlist.isAlbum ? 'Albüm' : 'Topluluk listesi'}</div>
        <h2 class="playlisthead__name">${esc(playlist.name)}</h2>
        <div class="playlisthead__meta">
          ${playlist.user ? `<a href="#/artist/${esc(playlist.user.id)}">${esc(playlist.user.name)}</a>` : ''}
          <span>${fmtCount(playlist.trackCount)} parça</span>
          <span>${data.tracks.length} yüklendi</span>
        </div>
        ${playlist.description ? `<p class="artisthead__bio">${esc(playlist.description)}</p>` : ''}
        <div class="playlisthead__actions">
          <button class="btn btn--primary" data-act="play-list" data-list="playlist" data-index="0" ${tracks.length ? '' : 'disabled'}>${icon('play')} Listeyi çal</button>
          <button class="btn btn--glass" data-act="shuffle-list" data-list="playlist" ${tracks.length ? '' : 'disabled'}>${icon('shuffle')} Karıştır</button>
          ${playlist.permalink ? `<a class="btn btn--ghost" href="https://audius.co${esc(playlist.permalink)}" target="_blank" rel="noopener noreferrer">${icon('external')} Audius'ta aç</a>` : ''}
        </div>
      </div>
    </header>
    <section class="section">
      ${sectionHead('Parçalar', data.limited ? 'İlk 100 kayıt gösteriliyor' : '')}
      ${
        tracks.length
          ? `<div class="rows">${tracks.map((track, index) => trackRow(track, index, 'playlist')).join('')}</div>`
          : emptyState('Liste boş', 'Bu listede oynatılabilir parça yok.')
      }
    </section>`;
}

export function renderGenre(data, genre, time = 'week') {
  resetLists();
  const tracks = visibleTracks(data.tracks);
  lists.genre = tracks;
  const title = genre ? genreLabel(genre) : 'Tüm katalog';

  return `<header class="artisthead" style="--hue:${hueFor(genre || 'all')}">
      <div class="artisthead__body">
        <div class="eyebrow">Sahne · ${time === 'week' ? 'hafta' : time === 'month' ? 'ay' : 'tüm zamanlar'}</div>
        <h2 class="artisthead__name">${esc(title)}</h2>
        <div class="artisthead__meta">Audius trendleri · ${tracks.length} kayıt</div>
        <div class="artisthead__actions">
          <button class="btn btn--primary" data-act="play-list" data-list="genre" data-index="0" ${tracks.length ? '' : 'disabled'}>${icon('play')} Çal</button>
          <button class="btn btn--glass" data-act="shuffle-list" data-list="genre" ${tracks.length ? '' : 'disabled'}>${icon('shuffle')} Karıştır</button>
          <div class="seg">
            <button data-act="genre-time" data-time="week" aria-pressed="${time === 'week'}">Hafta</button>
            <button data-act="genre-time" data-time="month" aria-pressed="${time === 'month'}">Ay</button>
            <button data-act="genre-time" data-time="all" aria-pressed="${time === 'all'}">Tümü</button>
          </div>
        </div>
      </div>
    </header>
    <section class="section">
      ${sectionHead('Yükselenler', 'Gerçek dinleme verisinden sıralanır')}
      ${
        tracks.length
          ? `<div class="rows">${tracks.map((track, index) => trackRow(track, index, 'genre')).join('')}</div>`
          : emptyState('Bu sahnede kayıt yok', 'Başka bir tür ya da zaman aralığı dene.')
      }
    </section>`;
}

export function renderLibrary() {
  resetLists();
  const liked = Object.values(library.likes).sort((a, b) => (b.likedAt || 0) - (a.likedAt || 0));
  const recent = library.recent.slice(0, 12);
  lists.recent = recent;
  lists.liked = liked;

  return `<div class="libhead">
      <div>
        <div class="eyebrow">Yerel kitaplık</div>
        <h2 class="section__title">Senin odan</h2>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn--glass btn--sm" data-act="open-files">${icon('disc')} Dosya aç</button>
        <button class="btn btn--glass btn--sm" data-act="create-playlist">${icon('plus')} Liste kur</button>
      </div>
    </div>
    <div class="library">
      <section>
        <div class="libhead">
          <span class="libhead__title">Listelerin · ${library.playlists.length}</span>
        </div>
        ${
          library.playlists.length
            ? `<div class="pgrid">${library.playlists
                .map((playlist) => `<div class="pcard" style="--hue:${hueFor(playlist.id)}">
                  <a class="pcard__art" href="#/local/${esc(playlist.id)}" aria-label="${esc(playlist.name)}">${image(playlist.tracks[0] && (playlist.tracks[0].artSm || playlist.tracks[0].art), '', playlist.name)}</a>
                  <span class="pcard__meta">
                    <a class="pcard__title" href="#/local/${esc(playlist.id)}">${esc(playlist.name)}</a>
                    <span class="pcard__sub">${playlist.tracks.length} parça</span>
                  </span>
                  <button class="iconbtn" data-act="delete-playlist" data-id="${esc(playlist.id)}" aria-label="Listeyi sil">${icon('trash')}</button>
                </div>`)
                .join('')}</div>`
            : emptyState('Henüz listen yok', 'Bir liste kur, parçaları kuyruktan ya da satırlardan ekle.', 'Liste kur', 'create-playlist')
        }
        <section class="section">
          ${sectionHead('Beğenilenler', `${liked.length} kayıt`)}
          ${
            liked.length
              ? `<div class="rows">${liked.slice(0, 8).map((track, index) => trackRow(track, index, 'liked')).join('')}</div>
                 <div style="margin-top:12px"><a class="btn btn--ghost btn--sm" href="#/liked">Tümünü gör ${icon('arrow')}</a></div>`
              : emptyState('Kalp atmadın', 'Bir parçanın kalbine dokun; burada biriksin.')
          }
        </section>
      </section>
      <aside>
        <div class="libhead">
          <span class="libhead__title">Son çalınanlar</span>
        </div>
        ${
          recent.length
            ? `<div class="recents">${recent
                .map((track) => `<button class="recent" data-act="play-track" data-id="${esc(track.id)}" data-list="recent" style="--hue:${hueFor(track.id)}">
                  <span class="recent__art">${image(track.artSm || track.art, '', track.title)}</span>
                  <span class="recent__meta">
                    <span class="recent__title">${esc(track.title)}</span>
                    <span class="recent__artist">${esc(track.artist ? track.artist.name : '')}</span>
                  </span>
                  <span class="recent__when">${timeAgo(track.playedAt)}</span>
                </button>`)
                .join('')}</div>`
            : emptyState('Geçmiş boş', 'Dinlediğin parçalar burada birikir.')
        }
      </aside>
    </div>`;
}

export function renderLiked() {
  const liked = Object.values(library.likes).sort((a, b) => (b.likedAt || 0) - (a.likedAt || 0));
  resetLists();
  lists.liked = liked;
  return `<header class="artisthead" style="--hue:${hueFor('liked')}">
      <div class="artisthead__body">
        <div class="eyebrow">Yerel koleksiyon</div>
        <h2 class="artisthead__name">Beğenilenler</h2>
        <div class="artisthead__meta">${liked.length} parça · yalnızca bu bilgisayarda</div>
        <div class="artisthead__actions">
          <button class="btn btn--primary" data-act="play-list" data-list="liked" data-index="0" ${liked.length ? '' : 'disabled'}>${icon('play')} Çal</button>
          <button class="btn btn--glass" data-act="shuffle-list" data-list="liked" ${liked.length ? '' : 'disabled'}>${icon('shuffle')} Karıştır</button>
        </div>
      </div>
    </header>
    <section class="section">
      ${sectionHead('Kayıtlar', 'Kalp bıraktığın her şey')}
      ${
        liked.length
          ? `<div class="rows">${liked.map((track, index) => trackRow(track, index, 'liked')).join('')}</div>`
          : emptyState('Henüz beğeni yok', 'Bir parçanın kalbine dokun; koleksiyonun oluşsun.', 'Keşfet', 'go-discover')
      }
    </section>`;
}

export function renderQueuePage() {
  resetLists();
  const current = playback.current;
  const upcoming = playback.queue.slice(playback.index + 1);
  lists.queue = playback.queue;
  return `<div class="queuepage">
    <div class="eyebrow">Kuyruk</div>
    <h2 class="section__title" style="margin:4px 0 16px">Sırada ne var</h2>
    ${
      current
        ? `<div class="queuepage__now">
            ${image(current.artSm || current.art, '', current.title)}
            <div class="queuepage__meta">
              <div class="queuepage__title">${esc(current.title)}</div>
              <div class="queuepage__sub">${esc(current.artist ? current.artist.name : '')} · ${fmtTime(playback.position)} / ${fmtTime(playback.duration || current.duration)}</div>
            </div>
            <button class="btn btn--glass btn--sm" data-act="toggle-play">${playback.playing ? icon('pause') + ' Duraklat' : icon('play') + ' Sürdür'}</button>
          </div>`
        : emptyState('Kuyruk boş', 'Bir parça seç, sırayı buradan yönet.')
    }
    ${
      upcoming.length
        ? `<div class="rows">${upcoming.map((track, index) => trackRow(track, index, 'queue')).join('')}</div>`
        : current
          ? `<p class="dim" style="margin-top:16px;font-size:12px">Sırada başka parça yok. Çalan parça bitince duracak.</p>`
          : ''
    }
  </div>`;
}

export function renderInfo(track) {
  if (!track) {
    return emptyState('Bilgi yok', 'Şu anda çalan bir parça olmadığı için künye gösteremiyorum.');
  }
  const liked = isLiked(track.id);
  const kv = [];
  kv.push([
    'Kaynak',
    track.source && track.source !== 'audius'
      ? `${track.sourceLabel || track.source}${track.preview ? ' · 30 sn resmi önizleme' : ''}`
      : 'Audius · tam kayıt',
  ]);
  if (track.album) kv.push(['Albüm', track.album]);
  if (track.preview) {
    kv.push(['Süre', `0:30 önizleme · orijinal ${fmtTime(track.fullDuration || track.duration)}`]);
  } else if (track.duration) {
    kv.push(['Süre', fmtTime(track.duration)]);
  }
  if (track.genre) kv.push(['Tür', genreLabel(track.genre)]);
  if (track.bpm) kv.push(['Tempo', `${Math.round(track.bpm)} BPM`]);
  if (track.key) kv.push(['Ton', track.key]);
  if (track.released) kv.push(['Tarih', fmtDate(track.released)]);
  if (track.plays) kv.push(['Dinleme', fmtCount(track.plays)]);
  if (track.likes) kv.push(['Beğeni', fmtCount(track.likes)]);
  if (track.tags) kv.push(['Etiketler', track.tags.split(',').slice(0, 8).join(' · ')]);
  const tags = track.tags
    ? track.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 10)
        .map((tag) => `<span class="tag">#${esc(tag)}</span>`)
        .join('')
    : '';

  return `<div class="info__head">
      <div class="info__art">${image(track.artSm || track.art, '', track.title)}</div>
      <div>
        <div class="info__title">${esc(track.title)}</div>
        <div class="info__artist">${verifiedMark(track)}${track.artist ? esc(track.artist.name) : ''}</div>
      </div>
    </div>
    <div class="info__actions">
      <button class="iconbtn" data-act="toggle-like" data-id="${esc(track.id)}" aria-pressed="${liked}" aria-label="Beğen">${icon('heart')}</button>
      <button class="iconbtn" data-act="queue-add" data-id="${esc(track.id)}" aria-label="Kuyruğa ekle">${icon('plus')}</button>
      <button class="iconbtn" data-act="add-to-playlist" data-id="${esc(track.id)}" aria-label="Listeye ekle">${icon('library')}</button>
      ${track.artist ? `<button class="iconbtn" data-act="artist" data-id="${esc(track.artist.id)}" aria-label="Sanatçıyı aç">${icon('users')}</button>` : ''}
    </div>
    <dl class="info__kv">
      ${kv.map(([key, value]) => `<dt>${esc(key)}</dt><dd>${esc(value)}</dd>`).join('')}
    </dl>
    ${track.description ? `<div class="eyebrow" style="margin-bottom:6px">Künye</div><div class="info__desc">${esc(track.description)}</div>` : ''}
    ${tags ? `<div class="info__tags">${tags}</div>` : ''}
    ${track.external ? `<div class="info__actions" style="margin:14px 0 0"><a class="btn btn--ghost btn--sm" href="${esc(track.external)}" target="_blank" rel="noopener noreferrer">${icon('external')} ${track.source === 'audius' ? "Audius'ta aç" : `${esc(track.sourceLabel || 'Kaynak')} sayfası`}</a></div>` : ''}`;
}

export function queueList() {
  const current = playback.current;
  const upcoming = playback.queue.slice(playback.index + 1);
  if (!current && !upcoming.length) {
    return `<p class="dim" style="font-size:11.5px;padding:8px 4px">Kuyruk boş. Bir parçayı çalınca sıra burada görünür.</p>`;
  }
  const items = [];
  if (current) {
    items.push(`<li class="qitem is-current">
      <span class="qitem__idx">▶</span>
      <span class="qitem__art">${image(current.artSm || current.art, '', current.title)}</span>
      <span class="qitem__meta"><span class="qitem__title">${esc(current.title)}</span><span class="qitem__artist">${esc(current.artist ? current.artist.name : '')}</span></span>
      <span></span>
    </li>`);
  }
  upcoming.forEach((track, index) => {
    items.push(`<li class="qitem" style="--hue:${hueFor(track.id)}">
      <span class="qitem__idx">${String(index + 1).padStart(2, '0')}</span>
      <span class="qitem__art">${image(track.artSm || track.art, '', track.title)}</span>
      <button class="qitem__meta" data-act="play-queued" data-id="${esc(track.id)}" data-index="${playback.index + 1 + index}" style="text-align:left;background:none">
        <span class="qitem__title">${esc(track.title)}</span>
        <span class="qitem__artist">${esc(track.artist ? track.artist.name : '')}</span>
      </button>
      <button data-act="queue-remove" data-index="${playback.index + 1 + index}" aria-label="Kuyruktan çıkar">${icon('x')}</button>
    </li>`);
  });
  return items.join('');
}

export function emptyState(title, text, actionLabel = '', action = '') {
  return `<div class="empty">
    <span class="empty__mark">${icon('wave')}</span>
    <h3 class="empty__title">${esc(title)}</h3>
    ${text ? `<p>${esc(text)}</p>` : ''}
    ${actionLabel ? `<button class="btn btn--glass btn--sm" data-act="${esc(action)}">${esc(actionLabel)}</button>` : ''}
  </div>`;
}

export function skeletonHome() {
  return `<div class="sk sk--hero"></div>
    <div class="section"><div class="section__head"><div class="sk" style="width:180px;height:20px"></div></div>
      <div class="shelf">${Array.from({ length: 6 }, () => '<div class="tile"><div class="sk" style="aspect-ratio:1;border-radius:13px"></div><div class="sk" style="width:80%;height:12px"></div><div class="sk" style="width:50%;height:10px"></div></div>').join('')}</div>
    </div>`;
}

export function skeletonRows(count = 8) {
  return `<div class="rows">${Array.from(
    { length: count },
    () =>
      `<div class="skrow"><div class="sk" style="width:36px;height:36px;border-radius:6px"></div><div><div class="sk" style="width:52%;height:11px;margin-bottom:6px"></div><div class="sk" style="width:30%;height:9px"></div></div><div class="sk" style="width:40px;height:9px"></div></div>`,
  ).join('')}</div>`;
}

export function errorState(message, action = 'retry') {
  return `<div class="errorbox">
    <h3>Bağlantı tökezledi</h3>
    <p>${esc(message || 'Katalog yanıt vermedi.')}</p>
    <button class="btn btn--glass btn--sm" data-act="${esc(action)}">Yeniden dene</button>
  </div>`;
}

export function renderLocalPlaylist(playlist) {
  resetLists();
  const tracks = playlist.tracks || [];
  lists.playlist = tracks;
  return `<a class="backbtn" href="#/library">${icon('arrow')} Kitaplık</a>
    <header class="playlisthead" style="--hue:${hueFor(playlist.id)}">
      <div class="playlisthead__art">${image(tracks[0] && (tracks[0].art || tracks[0].artSm), '', playlist.name)}</div>
      <div class="playlisthead__body">
        <div class="eyebrow">Yerel liste</div>
        <h2 class="playlisthead__name">${esc(playlist.name)}</h2>
        <div class="playlisthead__meta"><span>${tracks.length} parça</span><span>${fmtDate(playlist.createdAt)}</span></div>
        <div class="playlisthead__actions">
          <button class="btn btn--primary" data-act="play-list" data-list="playlist" data-index="0" ${tracks.length ? '' : 'disabled'}>${icon('play')} Çal</button>
          <button class="btn btn--glass" data-act="shuffle-list" data-list="playlist" ${tracks.length ? '' : 'disabled'}>${icon('shuffle')} Karıştır</button>
          <button class="btn btn--danger" data-act="delete-playlist" data-id="${esc(playlist.id)}" data-redirect="1">${icon('trash')} Sil</button>
        </div>
      </div>
    </header>
    <section class="section">
      ${sectionHead('Parçalar')}
      ${
        tracks.length
          ? `<div class="rows">${tracks.map((track, index) => trackRow(track, index, 'playlist', { removable: true })).join('')}</div>`
          : emptyState('Liste boş', 'Bir parçanın yanındaki kitaplık düğmesiyle bu listeye ekle.')
      }
    </section>`;
}

export function playlistPicker(track) {
  const playlists = library.playlists;
  return `<div class="modal__head">
      <span class="modal__title">Listeye ekle</span>
      <button class="iconbtn" data-act="close-overlay" aria-label="Kapat">${icon('x')}</button>
    </div>
    <div class="modal__body">
      <div class="linkcard">
        <span class="pcard__art">${image(track.artSm || track.art, '', track.title)}</span>
        <span class="linkcard__meta">
          <span class="linkcard__title">${esc(track.title)}</span>
          <span class="linkcard__sub">${esc(track.artist ? track.artist.name : '')}</span>
        </span>
      </div>
      ${
        playlists.length
          ? `<div class="stack" id="pickerList">${playlists
              .map(
                (playlist) => `<button class="pcard" data-act="pick-playlist" data-id="${esc(playlist.id)}" data-track="${esc(track.id)}">
                  <span class="pcard__art" style="width:40px;height:40px">${image(playlist.tracks[0] && (playlist.tracks[0].artSm || playlist.tracks[0].art), '', playlist.name)}</span>
                  <span class="pcard__meta"><span class="pcard__title">${esc(playlist.name)}</span><span class="pcard__sub">${playlist.tracks.length} parça</span></span>
                  <span class="iconbtn" aria-hidden="true">${icon('plus')}</span>
                </button>`,
              )
              .join('')}</div>`
          : `<p class="dim" style="font-size:12px;margin:6px 0 12px">Henüz listen yok.</p>`
      }
      <div class="field" style="margin-top:16px">
        <span>Yeni liste</span>
        <div style="display:flex;gap:8px">
          <input class="input" id="newPlaylistName" placeholder="Liste adı" maxlength="60">
          <button class="btn btn--primary" data-act="create-playlist" data-track="${esc(track.id)}">Kur</button>
        </div>
      </div>
    </div>`;
}

export function renderSettings() {
  return `<div class="modal__head">
      <span class="modal__title">Ayarlar</span>
      <button class="iconbtn" data-act="close-overlay" aria-label="Kapat">${icon('x')}</button>
    </div>
    <div class="modal__body">
      <div class="settingrow">
        <div class="settingrow__meta"><div class="settingrow__title">Hareket</div><div class="settingrow__sub">Arayüz animasyonlarının yoğunluğu</div></div>
        <div class="seg" id="motionSeg">
          <button data-act="set-motion" data-motion="auto" aria-pressed="${settings.motion === 'auto'}">Oto</button>
          <button data-act="set-motion" data-motion="full" aria-pressed="${settings.motion === 'full'}">Tam</button>
          <button data-act="set-motion" data-motion="reduced" aria-pressed="${settings.motion === 'reduced'}">Az</button>
          <button data-act="set-motion" data-motion="none" aria-pressed="${settings.motion === 'none'}">Kapalı</button>
        </div>
      </div>
      <div class="settingrow">
        <div class="settingrow__meta"><div class="settingrow__title">Geçiş süresi <span class="mono dim" id="crossfadeOut">${settings.crossfade} sn</span></div><div class="settingrow__sub">Parçalar arası eşit güçlü crossfade</div></div>
        <input id="crossfade" type="range" min="0" max="12" step="1" value="${settings.crossfade}" aria-label="Crossfade saniyesi">
      </div>
      <div class="settingrow">
        <div class="settingrow__meta"><div class="settingrow__title">Ses düzeyi</div><div class="settingrow__sub">Çıkış seviyesi</div></div>
        <input id="volumeSetting" type="range" min="0" max="100" step="1" value="${Math.round(settings.volume * 100)}" aria-label="Ses düzeyi">
      </div>
      <div class="settingrow">
        <div class="settingrow__meta"><div class="settingrow__title">Otomatik seviye</div><div class="settingrow__sub">Sessiz kayıtları yavaşça yukarı çeker, tavanı aşmaz</div></div>
        <label class="switchrow" style="margin:0">
          <span class="sr-only">Otomatik seviye</span>
          <input id="autolevelSetting" type="checkbox" ${settings.autolevel ? 'checked' : ''}>
          <i aria-hidden="true"></i>
        </label>
      </div>
      <div class="settingrow">
        <div class="settingrow__meta"><div class="settingrow__title">Doğrulanmış filtresi</div><div class="settingrow__sub">Arama ve raflarda yalnızca Audius'ta doğrulanmış sanatçılar</div></div>
        <label class="switchrow" style="margin:0">
          <span class="sr-only">Doğrulanmış filtresi</span>
          <input id="verifiedOnlySetting" type="checkbox" ${settings.verifiedOnly ? 'checked' : ''}>
          <i aria-hidden="true"></i>
        </label>
      </div>
      <div class="settingrow settingrow--stack">
        <div class="settingrow__title" style="margin-bottom:6px">Ses yolu</div>
        <div class="note">${icon('spark')}<span>Kaynak Audius üzerinden tam uzunlukta akar. Zincir: 48 kHz float Web Audio, yedi bant EQ, yapıştırıcı kompresör, HRTF uzamsal motor, prosedürel konvolüsyon odası ve çıkış limiter'ı. 8D motoru yalnızca kendi akışımızda çalışır; gömülü YouTube/Spotify oynatımında devre dışıdır.</span></div>
      </div>
      <div class="settingrow">
        <div class="settingrow__meta"><div class="settingrow__title">Yerel veriler</div><div class="settingrow__sub">Beğeniler, listeler ve geçmiş bu tarayıcıda tutulur</div></div>
        <button class="btn btn--danger btn--sm" data-act="clear-data">Temizle</button>
      </div>
      <p class="mono dim" style="margin-top:14px">playerify · v0.1 · Audius kataloğu</p>
    </div>`;
}
