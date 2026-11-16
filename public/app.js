/* OGG / personal frequency. Owner credentials never leave the server. */
const $ = id => document.getElementById(id);
const state = { now: null, library: null, controller: null, api: null, loadedUri: null, selected: null, follow: true, wantsAudio: true, audible: false, ready: false, pendingPlay: false, playlistLimit: 8, recentLimit: 8, retryMs: 8000, failures: 0 };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const iconNS = 'http://www.w3.org/2000/svg';
let pollTimer, libraryTimer, autoplayTimer, toastTimer, iframeLoading = false;

function icon(name) {
  const svg = document.createElementNS(iconNS, 'svg'), use = document.createElementNS(iconNS, 'use');
  svg.setAttribute('aria-hidden', 'true'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
}
function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}
function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3500);
}
function safeUrl(value, image = false) {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:') return null;
    return image ? ((u.hostname.endsWith('.scdn.co') || u.hostname.endsWith('.spotifycdn.com') || u.hostname === 'platform-lookaside.fbsbx.com') ? u.href : null) : (u.hostname === 'open.spotify.com' ? u.href : null);
  } catch { return null; }
}
function time(ms) {
  const seconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
function relativeTime(iso) {
  const date = new Date(iso), minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (!Number.isFinite(minutes)) return '';
  if (minutes < 1) return 'agora'; if (minutes < 60) return `há ${minutes} min`;
  if (minutes < 1440) return `há ${Math.floor(minutes / 60)} h`;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'America/Bahia' });
}
function externalLink(url, label) {
  const a = el('a', '', label); a.href = safeUrl(url) || 'https://open.spotify.com/'; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
}
function setArtwork(url) {
  const source = safeUrl(url, true), image = $('album-art');
  image.hidden = !source;
  if (!source) { image.removeAttribute('src'); $('ambient').style.backgroundImage = 'none'; return; }
  image.src = source;
  $('ambient').style.backgroundImage = `url(${JSON.stringify(source)})`;
  // Optional cover-derived tint. If CORS or canvas access fails, keep the brand color.
  const sample = new Image(); sample.crossOrigin = 'anonymous';
  sample.onload = () => {
    try {
      if (source !== safeUrl(state.now?.albumImageUrl, true)) return;
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 12;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(sample, 0, 0, 12, 12);
      const pixels = context.getImageData(0, 0, 12, 12).data; let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (Math.max(pixels[i], pixels[i+1], pixels[i+2]) < 50) continue;
        r += pixels[i]; g += pixels[i+1]; b += pixels[i+2]; count++;
      }
      if (!count) return;
      const values = [r, g, b].map(v => Math.round(v / count));
      const max = Math.max(...values), light = values.map(v => Math.round(v / Math.max(1, max) * 95 + 150));
      document.documentElement.style.setProperty('--accent', `rgb(${light.join(',')})`);
      document.documentElement.style.setProperty('--accent-rgb', light.join(','));
    } catch { /* The original OGG color is a complete fallback. */ }
  };
  sample.src = source;
}
$('album-art').addEventListener('error', () => { $('album-art').hidden = true; });

function updateButton() {
  const canFollow = Boolean(state.now?.hasTrack);
  $('listen').disabled = !canFollow;
  const playingLive = state.audible && state.follow && state.loadedUri === state.now?.uri;
  $('listen-icon').setAttribute('href', playingLive ? '#i-pause' : '#i-play');
  $('listen-label').textContent = playingLive ? 'Pausar som' : (state.follow ? (state.ready && state.wantsAudio ? 'Ativar som' : 'Ouvir junto') : 'Voltar ao som do OGG');
  document.body.classList.toggle('is-audible', state.audible);
}
function renderNow(data) {
  const previous = state.now;
  state.now = data; state.failures = 0; state.retryMs = 8000;
  document.body.classList.toggle('is-live', Boolean(data.isPlaying));
  $('live-dot').classList.toggle('offline', !data.isPlaying);
  $('owner-status').textContent = data.isPlaying ? 'OGG TÁ OUVINDO AGORA' : (data.hasTrack ? 'PAUSA NO SOM DO OGG' : 'ENTRE UM SOM E OUTRO');
  $('track-title').textContent = data.hasTrack ? data.title : 'O próximo som vem aí.';
  $('track-artist').textContent = data.hasTrack ? data.artist : 'Enquanto isso, explora minhas playlists.';
  $('duration-time').textContent = time(data.durationMs);
  $('cover-caption').textContent = data.hasTrack ? data.album || 'OGG / ON REPEAT' : 'FREQUÊNCIA PESSOAL';
  if (data.albumImageUrl !== previous?.albumImageUrl) {
    setArtwork(data.albumImageUrl);
    $('album-art').alt = data.hasTrack ? `Capa de ${data.album || data.title}` : 'Capa do álbum';
  }
  if (state.follow && data.hasTrack) {
    if (data.uri !== previous?.uri || (data.isPlaying && !previous?.isPlaying)) {
      selectContent({ uri: data.uri, title: data.title, artist: data.artist }, { follow: true, play: state.wantsAudio, automatic: true });
    }
  }
  // Follow song changes, but keep the visitor's own audio controls independent
  // of the owner's pauses. Never override a visitor who deliberately paused.
  updateProgress(); updateButton();
}
function updateProgress() {
  const track = state.now;
  const elapsed = track?.isPlaying ? Math.max(0, Date.now() - track.checkedAt) : 0;
  const position = Math.min(track?.durationMs || 0, (track?.progressMs || 0) + elapsed);
  const percent = track?.durationMs ? Math.min(100, position / track.durationMs * 100) : 0;
  $('progress-fill').style.width = `${percent}%`;
  $('progress-time').textContent = time(position);
  $('owner-progress').setAttribute('aria-valuenow', String(Math.round(percent)));
}

function ensureIframe() {
  if (state.api) return createController();
  if (iframeLoading) return;
  iframeLoading = true;
  const script = document.createElement('script'); script.src = 'https://open.spotify.com/embed/iframe-api/v1'; script.async = true;
  script.onerror = () => { iframeLoading = false; $('player-state').textContent = 'Player indisponível'; $('audio-note').textContent = 'O Spotify não carregou. Tenta novamente ou abre a faixa no app.'; };
  document.body.append(script);
}
window.onSpotifyIframeApiReady = api => { state.api = api; createController(); };
function createController() {
  if (state.controller || !state.selected || !state.api) return;
  state.api.createController($('spotify-embed'), { uri: state.selected.uri, width: '100%', height: 152 }, controller => {
    state.controller = controller; state.loadedUri = state.selected.uri;
    controller.addListener('ready', () => { state.ready = true; if (state.pendingPlay) attemptPlay(); updateButton(); });
    controller.addListener('playback_started', () => { clearTimeout(autoplayTimer); state.audible = true; $('player-state').textContent = 'Som ligado'; $('audio-note').textContent = state.follow ? 'Mesma faixa. Acompanhando as próximas trocas do OGG.' : 'Curtindo uma faixa da coleção.'; updateButton(); });
    controller.addListener('playback_update', event => {
      const playback = event.data; if (!playback) return;
      state.audible = !playback.isPaused && !playback.isBuffering;
      if (state.audible) { clearTimeout(autoplayTimer); $('player-state').textContent = 'Som ligado'; }
      else if (playback.isBuffering) $('player-state').textContent = 'Carregando som…';
      else $('player-state').textContent = state.wantsAudio ? 'Toque em Play para ouvir' : 'Som pausado';
      updateButton();
    });
  });
}
function attemptPlay() {
  state.pendingPlay = true;
  if (!state.controller || !state.ready) return;
  state.pendingPlay = false;
  state.controller.play();
  clearTimeout(autoplayTimer);
  autoplayTimer = setTimeout(() => {
    if (state.audible || !state.wantsAudio) return;
    $('player-state').textContent = 'Toque em Play para ouvir';
    $('audio-note').textContent = 'Se o som não começou, toca em “Ativar som” ou no Play do Spotify.';
    updateButton();
  }, 3500);
}
function selectContent(content, { follow = false, play = true, automatic = false } = {}) {
  if (!/^spotify:(track|episode|playlist):[A-Za-z0-9]{22}$/.test(content?.uri || '')) return;
  state.selected = content; state.follow = follow; $('follow').checked = follow;
  if (!automatic) state.wantsAudio = play;
  state.pendingPlay = play;
  $('player-dock').hidden = false; document.body.classList.add('has-player');
  $('player-context').textContent = follow ? 'OUVINDO COM OGG' : 'NA MINHA COLEÇÃO';
  if (state.controller) {
    if (state.loadedUri !== content.uri) {
      state.audible = false; state.loadedUri = content.uri;
      if (typeof state.controller.loadEntity === 'function') state.controller.loadEntity(content.uri);
      else state.controller.loadUri(content.uri);
      // Give the official iframe time to initialize the new resource.
      setTimeout(() => { if (state.loadedUri === content.uri && state.wantsAudio && play) attemptPlay(); }, 500);
    } else if (play) attemptPlay();
  } else ensureIframe();
  if (!automatic) {
    $('player-dock').classList.remove('collapsed'); $('collapse-player').setAttribute('aria-expanded', 'true');
    $('collapse-player').setAttribute('aria-label', 'Recolher player');
    toast(follow ? 'Na mesma frequência do OGG.' : `No player: ${content.title || 'playlist'}`);
  }
  updateButton();
}
$('listen').addEventListener('click', () => {
  if (state.audible && state.follow && state.loadedUri === state.now?.uri) {
    state.wantsAudio = false; state.pendingPlay = false; clearTimeout(autoplayTimer); state.controller?.pause(); state.audible = false;
    $('audio-note').textContent = 'Som pausado por aqui. O Spotify do OGG continua normalmente.'; updateButton(); return;
  }
  if (state.now?.hasTrack) { state.wantsAudio = true; selectContent({ uri: state.now.uri, title: state.now.title }, { follow: true }); }
});
$('follow').addEventListener('change', event => {
  state.follow = event.target.checked;
  if (state.follow && state.now?.hasTrack) selectContent({ uri: state.now.uri, title: state.now.title }, { follow: true, play: state.wantsAudio });
  else $('player-context').textContent = 'EXPLORANDO MEU SOM';
  updateButton();
});
// Real user interaction can unlock audio in browsers that refused autoplay.
// Never synthesize gestures or restart audio after the visitor paused it.
function unlockOnInteraction(event) {
  if (!event.isTrusted || !state.wantsAudio || state.audible || !state.ready || !state.selected) return;
  if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
  const control = event.target instanceof Element ? event.target.closest('button, a, input, label') : null;
  if (control?.id === 'listen' || control?.matches('.playlist-play, .recent-play, a[target="_blank"]')) return;
  attemptPlay();
}
document.addEventListener('click', unlockOnInteraction);
document.addEventListener('keydown', unlockOnInteraction);
$('collapse-player').addEventListener('click', () => {
  const collapsed = $('player-dock').classList.toggle('collapsed');
  $('collapse-player').setAttribute('aria-expanded', String(!collapsed));
  $('collapse-player').setAttribute('aria-label', collapsed ? 'Expandir player' : 'Recolher player');
});

function cover(src, name, className = '') {
  const img = el('img', className); img.src = safeUrl(src, true) || '/assets/ogg-orbital.png'; img.alt = name; img.loading = 'lazy'; img.decoding = 'async';
  if (!safeUrl(src, true)) img.classList.add('fallback', 'placeholder-logo');
  img.addEventListener('error', () => { img.src = '/assets/ogg-orbital.png'; img.classList.add('fallback', 'placeholder-logo'); }, { once: true });
  return img;
}
function renderPlaylists() {
  const grid = $('playlists-grid'); grid.replaceChildren();
  if (!state.library) { grid.append(el('p', 'empty-state', 'As playlists estão indisponíveis no momento. Tenta novamente daqui a pouco.')); return; }
  const query = $('playlist-search').value.trim().toLocaleLowerCase('pt-BR');
  const items = state.library.playlists.filter(p => `${p.name} ${p.description}`.toLocaleLowerCase('pt-BR').includes(query));
  if (!items.length) grid.append(el('p', 'empty-state', query ? 'Nenhuma playlist com esse nome. Tenta outra vibe.' : (state.library.availability?.playlists !== 'ready' ? 'As playlists estão indisponíveis por aqui. Você ainda pode explorar meu perfil no Spotify.' : 'Nenhuma playlist pública disponível por enquanto.')));
  for (const [index, p] of items.slice(0, state.playlistLimit).entries()) {
    const card = el('article', 'playlist'); card.style.animationDelay = `${Math.min(index, 7) * 40}ms`;
    const art = el('div', 'playlist-art'); art.append(cover(p.image, `Capa da playlist ${p.name}`));
    const button = el('button', 'playlist-play'); button.append(icon('play')); button.setAttribute('aria-label', `Ouvir ${p.name}`); button.addEventListener('click', () => selectContent({ uri: p.uri, title: p.name })); art.append(button);
    const heading = el('h3', '', p.name); heading.title = p.name;
    const desc = el('p', 'playlist-desc', p.description || 'Uma seleção pra entrar na vibe.');
    const meta = el('div', 'playlist-meta'); meta.append(el('span', '', `${p.total} FAIXAS`)); const link = externalLink(p.url, 'Spotify'); link.append(icon('arrow')); meta.append(link);
    card.append(art, heading, desc, meta); grid.append(card);
  }
  $('more-playlists').hidden = items.length <= state.playlistLimit;
}
function renderRecent() {
  const list = $('recent-list'); list.replaceChildren();
  const items = state.library?.recent || [];
  if (!items.length) list.append(el('p', 'empty-state', 'Os últimos sons ainda não estão disponíveis. Enquanto isso, vem de playlist.'));
  for (const [index, track] of items.slice(0, state.recentLimit).entries()) {
    const row = el('article', 'recent-row'); row.append(el('span', 'recent-index', String(index + 1).padStart(2, '0')), cover(track.albumImageUrl, `Capa de ${track.album || track.title}`, 'recent-image'));
    const info = el('div', 'recent-info'), title = el('div', 'recent-title', track.title); title.title = track.title; info.append(title, el('div', 'recent-artist', track.artist));
    const date = el('time', 'recent-time', relativeTime(track.playedAt)); if (track.playedAt) { date.dateTime = track.playedAt; date.title = new Date(track.playedAt).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }); }
    const button = el('button', 'recent-play'); button.append(icon('play')); button.setAttribute('aria-label', `Ouvir ${track.title}, ${track.artist}`); button.addEventListener('click', () => selectContent(track));
    row.append(info, el('div', 'recent-album', track.album), date, button); list.append(row);
  }
  $('more-recent').hidden = items.length <= state.recentLimit;
}
function renderLibrary(data) {
  state.library = data;
  $('profile-name').replaceChildren(document.createTextNode(data.profile.name + ' '), el('span', 'handle', data.profile.name.toLowerCase() === 'ogg' ? '/ Daniel Victor' : '/ ogg'));
  $('profile-link').href = safeUrl(data.profile.url) || 'https://open.spotify.com/';
  if (safeUrl(data.profile.image, true)) $('profile-image').src = data.profile.image;
  $('profile-image').alt = `Perfil de ${data.profile.name}`;
  $('playlist-count').textContent = data.availability?.playlists === 'ready' ? String(data.playlists.length) : '—';
  $('playlists-note').textContent = data.playlistsTruncated ? 'Uma seleção das minhas playlists públicas. Tem mais no meu perfil.' : 'Playlists públicas criadas por mim. Cada uma, um pedacinho da minha vibe.';
  renderPlaylists(); renderRecent();
}
$('playlist-search').addEventListener('input', () => { state.playlistLimit = 8; renderPlaylists(); });
$('more-playlists').addEventListener('click', () => { state.playlistLimit += 8; renderPlaylists(); });
$('more-recent').addEventListener('click', () => { state.recentLimit += 10; renderRecent(); });

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) {
    const error = new Error('unavailable'); error.retryAfter = Math.min(300, Number(response.headers.get('Retry-After')) || 0); throw error;
  }
  return response.json();
}
async function pollNow() {
  clearTimeout(pollTimer);
  if (document.hidden) return;
  try { renderNow(await getJson('/api/musica')); }
  catch (error) {
    state.failures++; state.retryMs = Math.max(error.retryAfter * 1000, Math.min(60000, 8000 * 2 ** Math.min(state.failures, 3)));
    $('owner-status').textContent = 'RECONECTANDO AO SPOTIFY';
    $('audio-note').textContent = 'A conexão oscilou. Vou tentar de novo em instantes.';
    if (!state.now) { $('track-title').textContent = 'O som volta já.'; $('track-artist').textContent = 'Explora a coleção enquanto a conexão volta.'; }
  } finally { pollTimer = setTimeout(pollNow, state.retryMs); }
}
async function pollLibrary() {
  clearTimeout(libraryTimer); if (document.hidden) return;
  try { renderLibrary(await getJson('/api/biblioteca')); }
  catch { if (!state.library) { renderPlaylists(); renderRecent(); } }
  finally { libraryTimer = setTimeout(pollLibrary, 60000); }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(pollTimer); clearTimeout(libraryTimer); }
  else { pollNow(); pollLibrary(); }
});
setInterval(() => { if (!document.hidden) updateProgress(); }, 1000);
$('share').addEventListener('click', async () => {
  try {
    if (navigator.share) await navigator.share({ title: 'OGG • Minha frequência', text: 'Entra na minha frequência. Ouve comigo.', url: 'https://oggspotify.vercel.app/' });
    else { await navigator.clipboard.writeText('https://oggspotify.vercel.app/'); toast('Link copiado. Espalha a frequência.'); }
  } catch (error) { if (error.name !== 'AbortError') toast('Compartilha: oggspotify.vercel.app'); }
});
function toggleImmersive(force) {
  const enabled = typeof force === 'boolean' ? (document.body.classList.toggle('immersive', force), force) : document.body.classList.toggle('immersive');
  $('immersive').setAttribute('aria-pressed', String(enabled)); $('immersive').setAttribute('aria-label', enabled ? 'Sair do modo imersivo' : 'Ativar modo imersivo');
  if (enabled) window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
}
$('immersive').addEventListener('click', () => toggleImmersive());
document.addEventListener('keydown', event => { if (event.key === 'Escape') toggleImmersive(false); });
for (let i = 0; i < 48; i++) {
  const bar = document.createElement('i'); bar.style.setProperty('--h', `${7 + Math.abs(Math.sin(i * 1.37)) * 19}px`); bar.style.setProperty('--delay', `${-i * .091}s`); $('spectrum').append(bar);
}
if (!reducedMotion && matchMedia('(pointer: fine)').matches) {
  $('art-stage').addEventListener('pointermove', event => {
    const rect = $('art-stage').getBoundingClientRect(), x = (event.clientX - rect.left) / rect.width - .5, y = (event.clientY - rect.top) / rect.height - .5;
    $('cover-card').style.transform = `rotate(6deg) rotateY(${x * 10}deg) rotateX(${-y * 8}deg)`;
  }, { passive: true });
  $('art-stage').addEventListener('pointerleave', () => { $('cover-card').style.transform = ''; });
}
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) for (const link of document.querySelectorAll('.nav-link')) link.classList.toggle('active', link.hash === `#${entry.target.id}`);
  }, { rootMargin: '-15% 0px -65% 0px' });
  for (const id of ['agora', 'playlists', 'recentes']) observer.observe($(id));
}
// Warm the official player while the current song loads, rather than waiting
// for the API response before starting a second round of network requests.
ensureIframe(); pollNow(); pollLibrary();
