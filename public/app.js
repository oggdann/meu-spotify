/* OGG / personal frequency. Owner credentials never leave the server. */
const $ = id => document.getElementById(id);
const state = { now: null, library: null, controller: null, spotifyController: null, spotifyReady: false, spotifyUri: null, provider: 'spotify', preferred: 'auto', transitioning: false, unavailable: false, api: null, loadedUri: null, selected: null, follow: true, wantsAudio: true, audible: false, ready: false, pendingPlay: false, playlistLimit: 8, recentLimit: 8, retryMs: 8000, failures: 0 };
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const iconNS = 'http://www.w3.org/2000/svg';
let pollTimer, libraryTimer, statsTimer, autoplayTimer, videoBufferTimer, toastTimer, iframeLoading = false, spotifyCreating = false;
let selectionId = 0, youtubeLoading = false, youtubeReady = false, youtubePlayer = null, youtubePlayerReady = false, youtubeAdapter = null, youtubeUri = null, youtubeVideo = null, youtubeStarted = false;
const videoMatches = new Map();
let youtubeVisible = !('IntersectionObserver' in window);
let videoHasBeenVisible = false, miniVideoDismissed = false, videoPlacementQueued = false;

// The iframe stays in one DOM location. Resizing/repositioning the same surface
// avoids the playback reset caused by moving an iframe between containers.
function placeYouTube() {
  const slot = $('inline-video-slot');
  if (state.provider !== 'youtube' || slot.hidden || state.unavailable) {
    slot.classList.remove('is-floating'); document.body.classList.remove('video-floating');
    $('mini-video-toolbar').hidden = true; return;
  }
  const rect = $('cover-image').getBoundingClientRect();
  const width = document.documentElement.clientWidth || window.innerWidth;
  const height = window.visualViewport?.height || window.innerHeight;
  const visibleWidth = Math.max(0, Math.min(rect.right, width) - Math.max(rect.left, 0));
  const visibleHeight = Math.max(0, Math.min(rect.bottom, height) - Math.max(rect.top, 0));
  const coverVisible = rect.width > 0 && rect.height > 0 && visibleWidth * visibleHeight >= rect.width * rect.height * .5;
  if (coverVisible) videoHasBeenVisible = true;
  const expanded = !$('player-dock').classList.contains('collapsed');
  const dock = $('player-dock').getBoundingClientRect();
  const bottom = expanded ? Math.max(14, height - dock.top + 12) : 14;
  const floating = !coverVisible && videoHasBeenVisible && !miniVideoDismissed && state.wantsAudio && width >= 228 && height >= bottom + 244;
  slot.classList.toggle('is-floating', floating); document.body.classList.toggle('video-floating', floating);
  $('mini-video-toolbar').hidden = !floating;
  slot.style.setProperty('--video-left', rect.left + 'px'); slot.style.setProperty('--video-top', rect.top + 'px');
  slot.style.setProperty('--video-width', rect.width + 'px'); slot.style.setProperty('--video-height', rect.height + 'px');
  slot.style.setProperty('--floating-bottom', bottom + 'px');
  const wasVisible = youtubeVisible;
  youtubeVisible = floating || coverVisible;
  if (wasVisible === youtubeVisible || state.transitioning || state.controller !== youtubeAdapter) return;
  if (!youtubeVisible) {
    state.pendingPlay = state.wantsAudio; state.audible = false; state.controller?.pause();
    $('player-state').textContent = 'Vídeo pausado fora de vista'; updateButton();
  } else if (state.wantsAudio && !document.hidden) attemptPlay();
}
function scheduleYouTubePlacement() {
  if (videoPlacementQueued) return;
  videoPlacementQueued = true;
  const run = () => { videoPlacementQueued = false; placeYouTube(); };
  if (window.requestAnimationFrame) window.requestAnimationFrame(run); else run();
}

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
let paletteSource = null;
const spectrumBars = [], musicParticles = [];
let listeningStats = null, statsPeriod = 30;
let presenceSession = null, presenceItems = [], presenceBusy = false;
function coverPalette(pixels) {
  const buckets = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const max = Math.max(...rgb), min = Math.min(...rgb);
    if (max < 40 || min > 235 || pixels[i + 3] < 128) continue;
    const key = rgb.map(value => value >> 5).join(',');
    const bucket = buckets.get(key) || { count: 0, rgb: [0, 0, 0], saturation: 0 };
    bucket.count++; rgb.forEach((value, j) => { bucket.rgb[j] += value; });
    bucket.saturation += (max - min) / Math.max(1, max);
    buckets.set(key, bucket);
  }
  const colors = [...buckets.values()].sort((a, b) => (b.count + b.saturation * 2) - (a.count + a.saturation * 2)).map(bucket => bucket.rgb.map(value => Math.round(value / bucket.count)));
  const main = colors[0] || [154, 208, 74];
  const second = colors.find(color => color.reduce((sum, value, i) => sum + Math.abs(value - main[i]), 0) > 110) || [main[2], main[0], main[1]];
  const tint = rgb => rgb.map(value => Math.round(165 + value / Math.max(1, ...rgb) * 80));
  return { accent: tint(main), secondary: tint(second), background: main.map(value => Math.round(10 + value * .027)) };
}
function setCoverPalette(url) {
  const source = safeUrl(url, true);
  if (source === paletteSource) return;
  paletteSource = source;
  const apply = palette => {
    const root = document.documentElement.style;
    root.setProperty('--accent', 'rgb(' + palette.accent.join(',') + ')');
    root.setProperty('--accent-rgb', palette.accent.join(','));
    root.setProperty('--secondary-rgb', palette.secondary.join(','));
    root.setProperty('--bg', 'rgb(' + palette.background.join(',') + ')');
  };
  apply(coverPalette([]));
  if (!source) return;
  const sample = new Image(); sample.crossOrigin = 'anonymous';
  sample.onload = () => {
    if (source !== paletteSource) return;
    try {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 24;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(sample, 0, 0, 24, 24);
      apply(coverPalette(context.getImageData(0, 0, 24, 24).data));
    } catch { /* Keep the full OGG fallback if the cover cannot be sampled. */ }
  };
  sample.src = source;
}
function setMusicScene(content) {
  const seed = Array.from(content.uri || '').reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 7);
  const root = document.documentElement.style;
  document.body.setAttribute('data-scene', ['drift', 'orbit', 'pulse'][seed % 3]);
  root.setProperty('--scene-cycle', (8 + seed % 7) + 's');
  root.setProperty('--bar-cycle', (.6 + (seed % 6) / 10) + 's');
  root.setProperty('--scene-angle', (seed % 80 - 40) + 'deg');
  root.setProperty('--song-position', '0%');
  spectrumBars.forEach((bar, i) => {
    bar.style.setProperty('--h', (7 + Math.abs(Math.sin(seed + i * 1.37)) * 22) + 'px');
    bar.style.setProperty('--delay', (-i * .091 - seed % 4) + 's');
  });
  musicParticles.forEach((particle, i) => {
    particle.style.setProperty('--x', ((seed + i * 137) % 100) + '%');
    particle.style.setProperty('--y', ((seed + i * 73) % 100) + '%');
    particle.style.setProperty('--particle-cycle', (7 + (seed + i) % 9) + 's');
    particle.style.setProperty('--particle-delay', (-i * .7) + 's');
  });
  setCoverPalette(content.albumImageUrl || state.now?.albumImageUrl);
}
function setArtwork(url) {
  const source = safeUrl(url, true), image = $('album-art');
  image.hidden = !source;
  if (!source) { image.removeAttribute('src'); $('ambient').style.backgroundImage = 'none'; return; }
  image.src = source;
  $('ambient').style.backgroundImage = 'url(' + JSON.stringify(source) + ')';
  if (state.follow || !state.selected) setCoverPalette(source);
}
$('album-art').addEventListener('error', () => { $('album-art').hidden = true; });

function updateButton() {
  const canFollow = Boolean(state.now?.hasTrack);
  $('listen').disabled = !canFollow;
  const playingLive = state.audible && state.follow && state.loadedUri === state.now?.uri;
  $('listen-icon').setAttribute('href', playingLive ? '#i-pause' : '#i-play');
  $('listen-label').textContent = playingLive ? 'Pausar som' : (state.follow ? (state.unavailable ? 'Escolher player' : state.transitioning ? 'Preparando som…' : state.ready && state.wantsAudio ? 'Ativar som' : 'Ouvir junto') : 'Voltar ao som do OGG');
  document.body.classList.toggle('is-audible', state.audible);
  $('dock-track').textContent = state.selected?.title || 'Preparando o som…';
  $('dock-play').disabled = !state.selected;
  $('dock-play').setAttribute('aria-label', state.audible ? 'Pausar música' : 'Tentar ouvir música');
  $('dock-play-icon').setAttribute('href', state.audible ? '#i-pause' : '#i-play');
  scheduleYouTubePlacement();
}
function renderNow(data) {
  const previous = state.now;
  state.now = data; state.failures = 0; state.retryMs = 8000;
  document.body.classList.toggle('is-live', Boolean(data.isPlaying));
  $('live-dot').classList.toggle('offline', !data.isPlaying);
  $('owner-status').textContent = data.isPlaying ? 'OGG TÁ OUVINDO AGORA' : (data.hasTrack ? 'PAUSA NO SOM DO OGG' : 'ENTRE UM SOM E OUTRO');
  $('track-title').textContent = data.hasTrack ? data.title : 'O próximo som vem aí.';
  $('track-artist').textContent = data.hasTrack ? data.artist : 'Enquanto isso, explora minhas playlists.';
  const playlistUrl = data.hasTrack && data.playlist?.id && /^[A-Za-z0-9]{22}$/.test(data.playlist.id) ? safeUrl(data.playlist.url) : null;
  $('owner-playlist').hidden = !playlistUrl;
  $('owner-playlist-name').textContent = playlistUrl ? data.playlist.name : '';
  if (playlistUrl) {
    $('owner-playlist-link').href = playlistUrl;
    $('owner-playlist-cover-link').href = playlistUrl;
    $('owner-playlist-cover').src = safeUrl(data.playlist.image, true) || '/assets/ogg-orbital.png';
    $('owner-playlist-cover').alt = 'Capa de ' + data.playlist.name;
  }
  else $('owner-playlist-link').removeAttribute('href');
  $('duration-time').textContent = time(data.durationMs);
  $('cover-caption').textContent = data.hasTrack ? data.album || 'OGG / ON REPEAT' : 'FREQUÊNCIA PESSOAL';
  if (data.albumImageUrl !== previous?.albumImageUrl) {
    setArtwork(data.albumImageUrl);
    $('album-art').alt = data.hasTrack ? `Capa de ${data.album || data.title}` : 'Capa do álbum';
  }
  if (state.follow && data.hasTrack) {
    if (data.uri !== previous?.uri || (data.isPlaying && !previous?.isPlaying)) {
      selectContent(data, { follow: true, play: state.wantsAudio, automatic: true });
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
  if (state.spotifyController || spotifyCreating || !state.selected || !state.api || state.provider !== 'spotify' || state.transitioning || state.unavailable) return;
  spotifyCreating = true;
  const initialUri = state.selected.uri;
  state.api.createController($('spotify-embed'), { uri: initialUri, width: '100%', height: 152 }, controller => {
    state.spotifyController = controller; state.spotifyUri = initialUri;
    if (state.provider === 'spotify' && !state.transitioning && !state.unavailable) { state.controller = controller; state.loadedUri = initialUri; }
    controller.addListener('ready', () => {
      state.spotifyReady = true;
      if (state.provider !== 'spotify' || state.controller !== controller || state.transitioning || state.unavailable) { controller.pause(); return; }
      state.ready = true;
      if (state.selected?.uri !== state.spotifyUri) useSpotify(state.selected, state.wantsAudio);
      else if (state.pendingPlay && state.wantsAudio) attemptPlay();
      updateButton();
    });
    controller.addListener('playback_started', () => { if (state.provider !== 'spotify' || state.controller !== controller || state.transitioning || state.unavailable) { controller.pause(); return; } clearTimeout(autoplayTimer); state.audible = true; $('player-state').textContent = 'Som ligado'; $('audio-note').textContent = state.follow ? 'Mesma faixa. Acompanhando as próximas trocas do OGG.' : 'Curtindo uma faixa da coleção.'; updateButton(); });
    controller.addListener('playback_update', event => {
      if (state.provider !== 'spotify' || state.controller !== controller || state.transitioning || state.unavailable) return;
      const playback = event.data; if (!playback) return;
      state.positionMs = Number(playback.position) || 0; state.playbackDurationMs = Number(playback.duration) || 0;
      if (state.audible && playback.isPaused && !playback.isBuffering) state.wantsAudio = false;
      state.audible = !playback.isPaused && !playback.isBuffering;
      if (state.audible) { clearTimeout(autoplayTimer); $('player-state').textContent = 'Som ligado'; }
      else if (playback.isBuffering) $('player-state').textContent = 'Carregando som…';
      else $('player-state').textContent = state.wantsAudio ? 'Toque em Play para ouvir' : 'Som pausado';
      updateButton();
    });
  });
}
function attemptPlay() {
  if (state.transitioning || state.unavailable || !state.wantsAudio) return;
  state.pendingPlay = true;
  if (!state.controller || !state.ready || (state.provider === 'youtube' && !youtubeVisible)) return;
  state.pendingPlay = false;
  state.controller.play();
  clearTimeout(autoplayTimer);
  autoplayTimer = setTimeout(() => {
    if (state.audible || !state.wantsAudio) return;
    $('player-state').textContent = 'Toque em Play para ouvir';
    $('audio-note').textContent = `O navegador pediu um toque para liberar o som. Usa “Ativar som” ou o Play do ${state.provider === 'youtube' ? 'YouTube' : 'Spotify'}.`;
    updateButton();
  }, 3500);
}
function detachController() {
  const old = state.controller;
  state.controller = null; state.audible = false; state.ready = false; state.loadedUri = null;
  old?.pause(); clearTimeout(autoplayTimer); clearTimeout(videoBufferTimer);
}
function showProvider(provider) {
  detachController(); state.provider = provider; state.unavailable = false;
  $('player-unavailable').hidden = true;
  $('spotify-player').hidden = provider !== 'spotify'; $('youtube-player').hidden = provider !== 'youtube';
  $('spotify-access').hidden = provider !== 'spotify';
  $('inline-video-slot').hidden = provider !== 'youtube';
  $('cover-card').classList.toggle('has-video', provider === 'youtube');
  $('cover-card').setAttribute('role', provider === 'youtube' ? 'group' : 'button');
  $('cover-card').setAttribute('aria-label', provider === 'youtube' ? 'Vídeo da faixa selecionada' : 'Alternar modo imersivo');
  $('player-dock').classList.toggle('youtube-active', provider === 'youtube');
  document.body.classList.toggle('has-youtube', provider === 'youtube');
  $('provider-label').textContent = provider === 'youtube' ? 'YouTube · sem conta do Spotify' : 'Player oficial do Spotify';
  $('player-disclaimer').textContent = provider === 'youtube' ? 'Reprodução pelo YouTube. A disponibilidade varia por faixa e região; o navegador pode pedir um toque para liberar o som.' : 'Reprodução pelo Spotify. Faixa completa ou prévia conforme a tua sessão.';
  placeYouTube();
}
function useSpotify(content, play, note = '') {
  state.transitioning = false; state.unavailable = false; $('player-unavailable').hidden = true;
  if (state.provider !== 'spotify') showProvider('spotify');
  $('spotify-access').hidden = false;
  state.controller = state.spotifyController; state.ready = state.spotifyReady; state.loadedUri = content.uri;
  if (note) $('audio-note').textContent = note;
  if (state.controller) {
    if (state.spotifyUri !== content.uri) {
      state.audible = false; state.spotifyUri = content.uri;
      if (typeof state.controller.loadEntity === 'function') state.controller.loadEntity(content.uri);
      else state.controller.loadUri(content.uri);
      setTimeout(() => { if (state.provider === 'spotify' && state.loadedUri === content.uri && state.wantsAudio && play) attemptPlay(); }, 500);
    } else if (play && state.wantsAudio) attemptPlay();
  } else ensureIframe();
  $('provider-label').textContent = 'Player oficial do Spotify';
  $('player-disclaimer').textContent = 'Reprodução pelo Spotify. Faixa completa ou prévia conforme a tua sessão.';
  updateButton();
}
function ensureYouTube() {
  if (youtubeReady) return startYouTube();
  if (youtubeLoading) return;
  youtubeLoading = true;
  const script = document.createElement('script'); script.src = 'https://www.youtube.com/iframe_api'; script.async = true;
  script.onerror = () => { youtubeLoading = false; youtubeFailure(); };
  document.body.append(script);
}
window.onYouTubeIframeAPIReady = () => { youtubeReady = true; startYouTube(); };
function unavailableYouTube(message) {
  state.transitioning = false;
  showProvider('youtube');
  state.unavailable = true; state.pendingPlay = false;
  $('youtube-player').hidden = true; $('spotify-player').hidden = true; $('inline-video-slot').hidden = true; $('cover-card').classList.remove('has-video');
  $('cover-card').setAttribute('role', 'button'); $('cover-card').setAttribute('aria-label', 'Alternar modo imersivo');
  $('player-unavailable').hidden = false; $('player-unavailable-note').textContent = message;
  $('spotify-access').hidden = false;
  $('provider-label').textContent = 'YouTube · indisponível para esta faixa';
  $('player-state').textContent = 'Escolha outro player'; $('audio-note').textContent = message;
  $('player-disclaimer').textContent = 'O Spotify continua disponível como outra opção de reprodução.';

  document.body.classList.remove('has-youtube');
  updateButton();
}
function youtubeFailure() {
  if (state.provider !== 'youtube' || !state.selected || state.transitioning || state.unavailable) return;
  const content = state.selected;
  $('player-state').textContent = 'YouTube indisponível';
  if (state.preferred === 'auto') useSpotify(content, state.wantsAudio, 'Essa versão não abriu no YouTube. O modo Automático tentou o Spotify.');
  else unavailableYouTube('O YouTube não conseguiu abrir esta faixa. Você pode tentar outra música ou escolher Spotify.');
}
function youtubeState(event) {
  if (state.provider !== 'youtube' || state.controller !== youtubeAdapter || state.transitioning || state.unavailable) return;
  clearTimeout(videoBufferTimer);
  if (event.data === 1 && !youtubeVisible) {
    state.audible = false; state.pendingPlay = state.wantsAudio; youtubePlayer?.pauseVideo?.(); updateButton(); return;
  }
  if (event.data === 1) {
    youtubeStarted = true; state.audible = true; state.wantsAudio = true; clearTimeout(autoplayTimer);
    $('player-state').textContent = 'Som ligado';
    $('audio-note').textContent = state.follow ? 'Mesma faixa pelo YouTube. Acompanhando as próximas trocas do OGG.' : 'Curtindo pelo YouTube, sem conta do Spotify.';
  } else {
    const wasAudible = state.audible; state.audible = false;
    if (event.data === 2 && wasAudible && youtubeStarted) state.wantsAudio = false;
    if (event.data === 0) { state.wantsAudio = false; $('player-state').textContent = 'Faixa terminou'; }
    else $('player-state').textContent = event.data === 3 ? 'Carregando som…' : (state.wantsAudio ? 'Ativar som' : 'Som pausado');
    if (event.data === 3) {
      const uri = state.loadedUri;
      videoBufferTimer = setTimeout(() => {
        if (state.provider === 'youtube' && state.loadedUri === uri && state.wantsAudio && !state.audible) youtubeFailure();
      }, 15000);
    }
  }
  updateButton();
}
function startYouTube() {
  if (!youtubeReady || state.provider !== 'youtube' || !youtubeVideo || state.transitioning || state.unavailable) return;
  if (!youtubePlayer) {
    const initialVideo = youtubeVideo;
    youtubeAdapter = { play: () => { youtubePlayer?.playVideo?.(); }, pause: () => { youtubePlayer?.pauseVideo?.(); } };
    state.controller = youtubeAdapter;
    youtubePlayer = new YT.Player('youtube-embed', { host: 'https://www.youtube-nocookie.com', width: '100%', height: '270', videoId: youtubeVideo,
      playerVars: { autoplay: state.wantsAudio && youtubeVisible ? 1 : 0, controls: 1, playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: () => {
          youtubePlayerReady = true;
          if (state.provider !== 'youtube' || state.controller !== youtubeAdapter || state.transitioning || state.unavailable) { youtubePlayer.pauseVideo(); return; }
          state.ready = true;
          if (youtubeVideo !== initialVideo) {
            if (state.pendingPlay && state.wantsAudio && youtubeVisible) youtubePlayer.loadVideoById(youtubeVideo);
            else youtubePlayer.cueVideoById(youtubeVideo);
          } else if (state.pendingPlay && state.wantsAudio) attemptPlay();
          else youtubePlayer.pauseVideo();
          updateButton();
        },
        onStateChange: youtubeState,
        onError: youtubeFailure,
        onAutoplayBlocked: () => { if (state.provider !== 'youtube' || state.controller !== youtubeAdapter || state.transitioning || state.unavailable) return; $('player-state').textContent = 'Ativar som'; $('audio-note').textContent = 'O navegador pediu um toque para liberar o som.'; updateButton(); }
      }
    });
  } else {
    state.controller = youtubeAdapter; state.ready = youtubePlayerReady;
    if (!youtubePlayerReady) return;
    if (youtubeUri !== state.selected.uri) {
      youtubeStarted = false;
      if (state.wantsAudio && state.pendingPlay && youtubeVisible) youtubePlayer.loadVideoById(youtubeVideo);
      else youtubePlayer.cueVideoById(youtubeVideo);
    } else if (state.pendingPlay && state.wantsAudio) attemptPlay();
  }
  youtubeUri = state.selected.uri;
}
async function findVideo(content) {
  const id = /^spotify:track:([A-Za-z0-9]{22})$/.exec(content.uri)?.[1];
  if (!id) return null;
  if (!videoMatches.has(id) || videoMatches.get(id).expires <= Date.now()) {
    const entry = { expires: Infinity };
    entry.task = getJson('/api/video?track=' + encodeURIComponent(id), 25000).catch(() => ({ videoId: null, reason: 'unavailable' })).then(result => {
      entry.expires = Date.now() + (result.videoId ? 86400000 : 60000);
      return result;
    });
    videoMatches.set(id, entry);
  }
  return videoMatches.get(id).task;
}
async function selectContent(content, { follow = false, play = true, automatic = false } = {}) {
  if (!/^spotify:(track|episode|playlist):[A-Za-z0-9]{22}$/.test(content?.uri || '')) return;
  // Detach before pausing so late iframe events cannot change the new intent.
  detachController(); state.transitioning = true; state.unavailable = false;
  $('player-unavailable').hidden = true;
  state.selected = content; state.follow = follow; $('follow').checked = follow;
  state.positionMs = 0; state.playbackDurationMs = content.durationMs || 0;
  setMusicScene(content);
  const entity = content.uri.split(':');
  $('spotify-login-link').href = 'https://accounts.spotify.com/login?continue=' + encodeURIComponent('https://open.spotify.com/' + entity[1] + '/' + entity[2]);
  $('spotify-access').hidden = true;
  if (!automatic) state.wantsAudio = play;
  if (!automatic) { videoHasBeenVisible = true; miniVideoDismissed = false; }
  state.pendingPlay = play;
  const requestId = ++selectionId;
  $('player-dock').hidden = false; document.body.classList.add('has-player');
  $('player-context').textContent = follow ? 'OUVINDO COM OGG' : 'NA MINHA COLEÇÃO';
  $('selected-track').textContent = `NO PLAYER: ${content.title || 'Playlist'}${content.artist ? ` · ${content.artist}` : ''}`;
  $('player-state').textContent = 'Preparando som…'; $('provider-label').textContent = 'Conferindo a faixa…';
  $('audio-note').textContent = 'Buscando esta faixa para ouvir junto…';
  updateButton();
  let match = null;
  if (state.preferred !== 'spotify' && content.uri.startsWith('spotify:track:')) match = await findVideo(content);
  if (requestId !== selectionId) return;
  state.transitioning = false;
  if (/^[\w-]{11}$/.test(match?.videoId || '')) {
    showProvider('youtube');
    state.loadedUri = content.uri; youtubeVideo = match.videoId;

    ensureYouTube();
  } else if (state.preferred === 'youtube') unavailableYouTube(content.uri.startsWith('spotify:playlist:') ? 'Esta playlist abre no Spotify. Para ouvir pelo YouTube, escolha uma faixa da lista de recentes.' : 'Ainda não encontrei esta faixa no YouTube. Escolha outra música ou use o Spotify.');
  else useSpotify(content, play);
  if (!automatic) {

    toast(follow ? 'Na mesma frequência do OGG.' : `No player: ${content.title || 'playlist'}`);
  }
  updateButton();
}
$('listen').addEventListener('click', () => {
  if (state.unavailable && state.follow) { setDockExpanded(true); $('player-source').focus(); toast('Escolha Spotify ou outra faixa disponível no YouTube.'); return; }
  if (state.audible && state.follow && state.loadedUri === state.now?.uri) {
    state.wantsAudio = false; state.pendingPlay = false; clearTimeout(autoplayTimer); state.controller?.pause(); state.audible = false;
    $('audio-note').textContent = 'Som pausado por aqui. O Spotify do OGG continua normalmente.'; updateButton(); return;
  }
  if (state.now?.hasTrack) { state.wantsAudio = true; selectContent(state.now, { follow: true }); }
});
$('follow').addEventListener('change', event => {
  state.follow = event.target.checked;
  if (state.follow && state.now?.hasTrack) selectContent(state.now, { follow: true, play: state.wantsAudio });
  else $('player-context').textContent = 'EXPLORANDO MEU SOM';
  updateButton();
});
$('player-source').addEventListener('change', event => {
  state.preferred = event.target.value;
  if (state.selected) selectContent(state.selected, { follow: state.follow, play: state.wantsAudio });
});
$('use-spotify').addEventListener('click', () => {
  state.preferred = 'spotify'; $('player-source').value = 'spotify';
  if (state.selected) selectContent(state.selected, { follow: state.follow, play: true });
});
$('spotify-retry').addEventListener('click', () => {
  if (!state.selected) return;
  // A fresh Embed can recognize the visitor's new Spotify browser session.
  // Owner authorization and the visitor's login are independent.
  detachController();
  const previous = state.spotifyController;
  state.spotifyController = null; state.spotifyReady = false; state.spotifyUri = null; spotifyCreating = false;
  previous?.destroy?.();
  const container = el('div'); container.id = 'spotify-embed';
  $('spotify-player').replaceChildren(container);
  state.preferred = 'spotify'; $('player-source').value = 'spotify';
  selectContent(state.selected, { follow: state.follow, play: true });
});
// Real user interaction can unlock audio in browsers that refused autoplay.
// Never synthesize gestures or restart audio after the visitor paused it.
function unlockOnInteraction(event) {
  if (!event.isTrusted || !state.wantsAudio || state.audible || !state.ready || !state.selected) return;
  if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
  const control = event.target instanceof Element ? event.target.closest('button, a, input, label') : null;
  if (control?.id === 'listen' || control?.id === 'dock-play' || control?.id === 'spotify-retry' || control?.matches('.playlist-play, .recent-play, a[target="_blank"]')) return;
  attemptPlay();
}
document.addEventListener('click', unlockOnInteraction);
document.addEventListener('keydown', unlockOnInteraction);
function setDockExpanded(expanded) {
  const collapsed = !expanded;
  $('player-dock').classList.toggle('collapsed', collapsed);
  document.body.classList.toggle('player-collapsed', collapsed);
  $('collapse-player').setAttribute('aria-expanded', String(expanded));
  $('collapse-player').setAttribute('aria-label', expanded ? 'Recolher controles de música' : 'Abrir controles de música');
  scheduleYouTubePlacement();
}
setDockExpanded(false);
$('collapse-player').addEventListener('click', () => setDockExpanded($('player-dock').classList.contains('collapsed')));
$('dock-play').addEventListener('click', () => {
  if (!state.selected) return;
  if (state.unavailable) { setDockExpanded(true); $('player-source').focus(); return; }
  if (state.audible) {
    state.wantsAudio = false; state.pendingPlay = false; clearTimeout(autoplayTimer);
    state.controller?.pause(); state.audible = false; $('player-state').textContent = 'Som pausado'; updateButton();
  } else {
    state.wantsAudio = true;
    if (state.provider === 'youtube') { videoHasBeenVisible = true; miniVideoDismissed = false; placeYouTube(); }
    attemptPlay();
  }
});
$('mini-video-options').addEventListener('click', () => setDockExpanded(true));
$('mini-video-close').addEventListener('click', () => {
  miniVideoDismissed = true; state.wantsAudio = false; state.pendingPlay = false; state.audible = false;
  clearTimeout(autoplayTimer); state.controller?.pause(); $('player-state').textContent = 'Som pausado';
  placeYouTube(); updateButton();
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
  $('playlists-note').textContent = data.playlistsTruncated ? 'Uma seleção das minhas playlists públicas. Tem mais no meu perfil.' : 'Playlists públicas que eu criei. Abre no Spotify e salva a tua favorita.';
  renderPlaylists(); renderRecent();
}
$('playlist-search').addEventListener('input', () => { state.playlistLimit = 8; renderPlaylists(); });
$('more-playlists').addEventListener('click', () => { state.playlistLimit += 8; renderPlaylists(); });
$('more-recent').addEventListener('click', () => { state.recentLimit += 10; renderRecent(); });

async function getJson(url, timeout = 12000) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout) });
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
function renderStats(data) {
  listeningStats = data;
  const period = data.periods?.find(item => item.days === statsPeriod);
  const format = value => Number(value || 0).toLocaleString('pt-BR');
  $('stats-week').setAttribute('aria-pressed', String(statsPeriod === 7));
  $('stats-month').setAttribute('aria-pressed', String(statsPeriod === 30));
  const official = statsPeriod === 30 && data.top?.availability === 'ready';
  $('stats-metrics').hidden = official;
  $('stats-plays').textContent = data.recentAvailability === 'ready' ? format(period?.plays) : '—';
  $('stats-track-count').textContent = data.recentAvailability === 'ready' && Number.isInteger(period?.trackCount) ? format(period.trackCount) : '—';
  $('stats-plays-status').textContent = 'Até ' + (data.sampleSize || 50) + ' registros disponíveis';
  $('stats-context').textContent = official ? 'Ranking oficial do Spotify · últimas 4 semanas.' : 'Últimos ' + statsPeriod + ' dias · ranking do recorte recente.';
  $('stats-disclosure').textContent = official ? 'Artistas e músicas mais ouvidos segundo o Spotify, atualizados automaticamente.' : 'Contagens dentro das últimas ' + (data.sampleSize || 50) + ' reproduções disponíveis. Esse recorte pode não cobrir o período inteiro.';
  for (const type of ['artists', 'tracks']) {
    const list = $('stats-' + type); list.replaceChildren();
    const entries = official ? data.top[type] : period?.[type] || [];
    entries.forEach((item, index) => {
      const row = el('li', 'stats-rank');
      row.append(el('span', 'stats-rank-number', String(index + 1).padStart(2, '0')));
      const link = externalLink(item.songUrl || item.url, item.title || item.name);
      link.className = 'stats-rank-link';
      const artwork = item.albumImageUrl || item.image;
      if (artwork) {
        const image = el('img'); image.src = safeUrl(artwork, true) || '/assets/ogg-orbital.png';
        image.alt = ''; image.width = image.height = 36; image.loading = 'lazy';
        link.prepend(image);
      }
      row.append(link);
      if (!official) row.append(el('span', 'stats-rank-count', String(item.count) + '×'));
      list.append(row);
    });
    if (!entries.length) list.append(el('li', 'stats-empty', 'Sem registros neste recorte.'));
  }
  $('stats-footnote').textContent = (official ? '' : 'Base do ranking: últimas 50 reproduções. Não cobre necessariamente o período inteiro. ') + 'O total de minutos ouvidos mostrado no aplicativo não é disponibilizado pela conexão oficial do Spotify.';
}
$('stats-week').addEventListener('click', () => { statsPeriod = 7; if (listeningStats) renderStats(listeningStats); });
$('stats-month').addEventListener('click', () => { statsPeriod = 30; if (listeningStats) renderStats(listeningStats); });
async function pollStats() {
  clearTimeout(statsTimer); if (document.hidden) return;
  try { renderStats(await getJson('/api/estatisticas')); }
  catch { $('stats-context').textContent = 'Os números estão indisponíveis agora. O som continua.'; }
  finally { statsTimer = setTimeout(pollStats, 60000); }
}
function renderPresence(items) {
  presenceItems = items || [];
  const wall = $('presence-wall'); wall.replaceChildren();
  for (const person of presenceItems) {
    const link = externalLink(person.url, ''); link.className = 'presence-person';
    const avatar = el('span', 'presence-avatar', (person.name || '?').slice(0, 1).toUpperCase());
    if (safeUrl(person.image, true)) { const image = el('img'); image.src = person.image; image.alt = ''; image.width = image.height = 40; image.loading = 'lazy'; avatar.replaceChildren(image); }
    const copy = el('span', 'presence-person-copy'); copy.append(el('strong', '', person.name), el('small', '', relativeTime(person.presentAt)));
    link.append(avatar, copy, icon('arrow')); wall.append(link);
  }
  if (!presenceItems.length) wall.append(el('p', 'presence-empty', 'O mural tá aberto. O próximo nome pode ser o teu.'));
  const mine = presenceItems.some(item => item.id === presenceSession?.profile?.id);
  $('presence-remove').hidden = !mine;
  $('presence-mark').textContent = mine ? 'Minha presença tá marcada' : 'Marcar minha presença';
}
async function pollPresence() {
  if (document.hidden) return;
  const jobs = await Promise.allSettled([getJson('/api/presenca?acao=lista'), getJson('/api/presenca?acao=eu')]);
  if (jobs[1].status === 'fulfilled') {
    presenceSession = jobs[1].value;
    const signedIn = Boolean(presenceSession.profile);
    $('presence-login').hidden = signedIn || !presenceSession.enabled;
    $('presence-session').hidden = !signedIn;
    if (signedIn) $('presence-greeting').textContent = 'Salve, ' + presenceSession.profile.name + '. Teu nome só vai pro mural quando tu marcar.';
  }
  if (jobs[0].status === 'fulfilled') {
    renderPresence(jobs[0].value.items);
    if (jobs[0].value.availability !== 'ready') $('presence-feedback').textContent = 'O mural está reconectando. Tenta de novo daqui a pouco.';
  }
  const code = new URLSearchParams(location.search || '').get('presenca');
  if (code) $('presence-feedback').textContent = code === 'conta-nao-liberada' ? 'O Spotify ainda não liberou tua conta pra este site. Me chama no @oggdann.' : 'A conexão com o Spotify não terminou. Tu pode tentar entrar de novo.';
}
async function presenceAction(action) {
  if (presenceBusy || !presenceSession?.csrf) return;
  presenceBusy = true;
  $('presence-mark').disabled = $('presence-remove').disabled = $('presence-logout').disabled = true;
  try {
    const response = await fetch('/api/presenca?acao=' + action, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csrf:presenceSession.csrf}),signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw Error('unavailable');
    const data = await response.json();
    if (data.items) renderPresence(data.items);
    if (action === 'sair') { presenceSession = null; await pollPresence(); }
    $('presence-feedback').textContent = action === 'marcar' ? 'Presença marcada. Tu tá no mural do OGG.' : action === 'remover' ? 'Teu perfil saiu do mural.' : 'Tu saiu da conta. A presença pode ser removida antes de sair.';
  } catch { $('presence-feedback').textContent = 'Não consegui confirmar agora. Entra de novo e tenta mais uma vez.'; }
  finally { presenceBusy = false; $('presence-mark').disabled = $('presence-remove').disabled = $('presence-logout').disabled = false; }
}
$('presence-mark').addEventListener('click', () => presenceAction('marcar'));
$('presence-remove').addEventListener('click', () => presenceAction('remover'));
$('presence-logout').addEventListener('click', () => presenceAction('sair'));
async function pollLibrary() {
  clearTimeout(libraryTimer); if (document.hidden) return;
  try { renderLibrary(await getJson('/api/biblioteca')); }
  catch { if (!state.library) { renderPlaylists(); renderRecent(); } }
  finally { libraryTimer = setTimeout(pollLibrary, 60000); }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearTimeout(pollTimer); clearTimeout(libraryTimer); clearTimeout(statsTimer);
    if (state.provider === 'youtube') { state.pendingPlay = state.wantsAudio; state.audible = false; state.controller?.pause(); updateButton(); }
  }
  else { pollNow(); pollLibrary(); pollStats(); pollPresence(); placeYouTube(); if (state.provider === 'youtube' && state.wantsAudio) attemptPlay(); }
});
setInterval(() => {
  if (document.hidden) return;
  updateProgress();
  let position = state.positionMs || 0, duration = state.playbackDurationMs || 0;
  if (state.provider === 'youtube' && state.ready && state.controller === youtubeAdapter) {
    position = (youtubePlayer?.getCurrentTime?.() || 0) * 1000;
    duration = (youtubePlayer?.getDuration?.() || 0) * 1000;
  }
  const percent = duration ? Math.min(100, Math.max(0, position / duration * 100)) : 0;
  document.documentElement.style.setProperty('--song-position', percent + '%');
}, 1000);
$('share').addEventListener('click', async () => {
  try {
    if (navigator.share) await navigator.share({ title: 'OGG • Meu som. Sem filtro.', text: 'Do grave à brisa. Cola no som do @oggdann.', url: 'https://oggspotify.vercel.app/' });
    else { await navigator.clipboard.writeText('https://oggspotify.vercel.app/'); toast('Link copiado. Espalha a frequência.'); }
  } catch (error) { if (error.name !== 'AbortError') toast('Compartilha: oggspotify.vercel.app'); }
});
function toggleImmersive(force) {
  const enabled = typeof force === 'boolean' ? (document.body.classList.toggle('immersive', force), force) : document.body.classList.toggle('immersive');
  $('immersive').setAttribute('aria-pressed', String(enabled)); $('immersive').setAttribute('aria-label', enabled ? 'Sair do modo imersivo' : 'Ativar modo imersivo');
  if (enabled) window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
}
$('immersive').addEventListener('click', () => toggleImmersive());
$('cover-card').addEventListener('click', () => { if (state.provider !== 'youtube' || state.unavailable) toggleImmersive(); });
$('cover-card').addEventListener('keydown', event => {
  if (['Enter', ' '].includes(event.key) && (state.provider !== 'youtube' || state.unavailable)) { event.preventDefault(); toggleImmersive(); }
});
document.addEventListener('keydown', event => { if (event.key === 'Escape') toggleImmersive(false); });
for (let i = 0; i < 20; i++) {
  const particle = document.createElement('b');
  particle.style.setProperty('--x', ((i * 137) % 100) + '%');
  particle.style.setProperty('--y', ((i * 73) % 100) + '%');
  particle.style.setProperty('--particle-cycle', (7 + i % 9) + 's');
  particle.style.setProperty('--particle-delay', (-i * .7) + 's');
  $('music-particles').append(particle); musicParticles.push(particle);
}
for (let i = 0; i < 48; i++) {
  const bar = document.createElement('i'); bar.style.setProperty('--h', `${7 + Math.abs(Math.sin(i * 1.37)) * 19}px`); bar.style.setProperty('--delay', `${-i * .091}s`); $('spectrum').append(bar); spectrumBars.push(bar);
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
  for (const id of ['agora', 'playlists', 'numeros', 'presenca']) observer.observe($(id));
}
// Warm YouTube while the current song loads. Spotify loads only when selected
// or when there is no matching YouTube version, so two players never start.
ensureYouTube(); pollNow(); pollLibrary(); pollStats(); pollPresence();

window.addEventListener('scroll', scheduleYouTubePlacement, {passive:true});
window.addEventListener('resize', scheduleYouTubePlacement, {passive:true});
window.visualViewport?.addEventListener('resize', scheduleYouTubePlacement, {passive:true});
window.visualViewport?.addEventListener('scroll', scheduleYouTubePlacement, {passive:true});
if ('ResizeObserver' in window) {
  const videoLayout = new ResizeObserver(scheduleYouTubePlacement);
  videoLayout.observe($('cover-image')); videoLayout.observe($('agora'));
}
document.fonts?.ready.then(scheduleYouTubePlacement);
