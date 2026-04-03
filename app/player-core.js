/**
 * BounceX Viewer — Player Core
 *
 * Shared engine consumed by both player.js (single-video) and playlist.js.
 * Exports globals: VIDEO_BASE, FPS, canvas constants, all pure utilities,
 * buildVideoWrapHTML(), buildControlsHTML(), and createPlayerEngine().
 *
 * DO NOT add page-specific logic here. If something only applies to one mode,
 * it belongs in player.js or playlist.js respectively.
 */

// ── Shared Constants ─────────────────────────────────────────────────────────

const VIDEO_BASE = 'videos'
const FPS = 60

// Canvas / rendering constants — single source of truth
const BALL_R = 7
const PX_PER_FRAME = 3
const EDGE_PAD = 8
const BX_HEIGHT_BELOW = 100 // px height when not in overlay mode (reference)
const BX_HEIGHT_OVERLAY = 200 // px height when in overlay mode

// ── Custom font loader ────────────────────────────────────────────────────────
//
// Collects all unique font names from text effects, then tries to load each
// one from the video's own folder. Tried extensions: woff2, woff, ttf, otf.
// Silently skips fonts that are already loaded or whose file isn't found.

const _loadedFonts = new Set()

async function loadEffectFonts(effects, videoFolder) {
  const EXTS = ['woff2', 'woff', 'ttf', 'otf']
  const BUILTIN = new Set([
    'sans-serif',
    'serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'Arial',
    'Georgia',
    'Impact',
    'Trebuchet MS',
    'Courier New',
    'Verdana',
    'Times New Roman',
    'JetBrains Mono',
    'Rajdhani',
  ])

  const needed = new Set(
    effects
      .filter((ef) => ef.type === 'text' && ef.font)
      .map((ef) => ef.font)
      .filter((name) => !BUILTIN.has(name) && !_loadedFonts.has(name)),
  )

  for (const name of needed) {
    for (const ext of EXTS) {
      const url = `${VIDEO_BASE}/${encodeURIComponent(videoFolder)}/${encodeURIComponent(name)}.${ext}`
      try {
        const face = new FontFace(name, `url('${url}')`)
        await face.load()
        document.fonts.add(face)
        _loadedFonts.add(name)
        break
      } catch {
        // file not found or failed to parse — try next extension
      }
    }
  }
}

// ── Godot 4 Tween Easing ─────────────────────────────────────────────────────
// TransitionType: 0=Linear 1=Sine 2=Quint 3=Quart 4=Quad 5=Expo
//                 6=Elastic 7=Cubic 8=Circ 9=Bounce 10=Back 11=Spring
// EaseType:       0=In 1=Out 2=InOut 3=OutIn

function godotEase(t, trans, ease) {
  const applyTrans = (x, type) => {
    switch (type) {
      case 0:
        return x
      case 1:
        return 1 - Math.cos((x * Math.PI) / 2)
      case 2:
        return x * x * x * x * x
      case 3:
        return x * x * x * x
      case 4:
        return x * x
      case 5:
        return x === 0 ? 0 : Math.pow(2, 10 * x - 10)
      case 6: {
        if (x === 0) return 0
        if (x === 1) return 1
        return (
          -Math.pow(2, 10 * x - 10) *
          Math.sin(((x * 10 - 10.75) * (2 * Math.PI)) / 3)
        )
      }
      case 7:
        return x * x * x
      case 8:
        return 1 - Math.sqrt(1 - x * x)
      case 9: {
        const n1 = 7.5625,
          d1 = 2.75
        let xi = 1 - x
        if (xi < 1 / d1) return 1 - n1 * xi * xi
        else if (xi < 2 / d1) return 1 - (n1 * (xi -= 1.5 / d1) * xi + 0.75)
        else if (xi < 2.5 / d1)
          return 1 - (n1 * (xi -= 2.25 / d1) * xi + 0.9375)
        else return 1 - (n1 * (xi -= 2.625 / d1) * xi + 0.984375)
      }
      case 10: {
        const c1 = 1.70158,
          c3 = c1 + 1
        return c3 * x * x * x - c1 * x * x
      }
      case 11:
        return 1 - Math.cos(x * Math.PI) * Math.exp(-x * 5)
      default:
        return x
    }
  }
  switch (ease) {
    case 0:
      return applyTrans(t, trans)
    case 1:
      return 1 - applyTrans(1 - t, trans)
    case 2:
      return t < 0.5
        ? applyTrans(t * 2, trans) / 2
        : 1 - applyTrans((1 - t) * 2, trans) / 2
    case 3:
      return t < 0.5
        ? (1 - applyTrans(1 - t * 2, trans)) / 2
        : 0.5 + applyTrans(t * 2 - 1, trans) / 2
    default:
      return t
  }
}

// ── Path Builder ─────────────────────────────────────────────────────────────

function buildPath(markerData, totalFrames) {
  const path = new Float32Array(totalFrames).fill(-1)

  const markers = Object.entries(markerData)
    .map(([k, v]) => ({
      frame: parseInt(k),
      depth: v[0],
      trans: v[1],
      ease: v[2],
      aux: v[3],
    }))
    .sort((a, b) => a.frame - b.frame)

  if (markers.length === 0) return path

  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i]
    const next = markers[i + 1]
    path[cur.frame] = cur.depth
    if (!next) {
      for (let f = cur.frame + 1; f < totalFrames; f++) path[f] = cur.depth
      break
    }
    const steps = next.frame - cur.frame
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      path[cur.frame + s] =
        cur.depth +
        (next.depth - cur.depth) * godotEase(t, next.trans, next.ease)
    }
  }
  return path
}

// ── Easing Labels ────────────────────────────────────────────────────────────

const TRANS_NAMES = [
  'Lin',
  'Sine',
  'Quint',
  'Quart',
  'Quad',
  'Expo',
  'Elastic',
  'Cubic',
  'Circ',
  'Bounce',
  'Back',
  'Spring',
]
const EASE_NAMES = ['In', 'Out', 'IO', 'OI']

function easeLabel(trans, ease) {
  return `${TRANS_NAMES[trans] || '?'}·${EASE_NAMES[ease] || '?'}`
}

// ── Utilities ────────────────────────────────────────────────────────────────

function framesToTimecode(frames) {
  const secs = Math.floor(frames / FPS)
  return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
}

function escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderDescription(text) {
  return escHtml(text)
    .replace(/\\n/g, '<br>')
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      (_, label, url) =>
        `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:var(--accent);text-decoration:none;">${label}</a>`,
    )
}

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  try {
    return await res.json()
  } catch (e) {
    throw new Error(`JSON parse failed for: ${url} (${e.message})`)
  }
}

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
  return res.text()
}

function hexToRgba(hex, alpha) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return null
  const n = parseInt(hex.slice(1), 16)
  if (Number.isNaN(n)) return null
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255
  return alpha != null ? `rgba(${r},${g},${b},${alpha})` : `rgb(${r},${g},${b})`
}

function buildColors(userSettings) {
  const def = (v, d) => (v != null && v !== '' ? v : d)
  return {
    bgSolid:
      (userSettings.bgColor && hexToRgba(userSettings.bgColor, 0.92)) ||
      '#0a0b0f',
    bgOverlay:
      (userSettings.bgColor && hexToRgba(userSettings.bgColor, 0.45)) ||
      'rgba(0,0,0,0.45)',
    topLine:
      (userSettings.topLineInactive &&
        hexToRgba(userSettings.topLineInactive, 0.15)) ||
      'rgba(255,255,255,0.15)',
    bottomLine:
      (userSettings.bottomLineInactive &&
        hexToRgba(userSettings.bottomLineInactive, 0.15)) ||
      'rgba(255,255,255,0.15)',
    topActive: def(userSettings.topLineActive, '#3dd6c8'),
    bottomActive: def(userSettings.bottomLineActive, '#f07849'),
    ball: def(userSettings.ballColor, '#ffffff'),
    pathColor: def(userSettings.pathColor, '#f0b429'),
  }
}

// ── BX2 Effect Helpers ────────────────────────────────────────────────────────

function getEffectFadeAlpha(ef, frame) {
  if (frame < ef.startFrame || frame > ef.endFrame) return 0
  const dur = ef.endFrame - ef.startFrame
  const el = frame - ef.startFrame
  let alpha = 1.0
  const fi = ef.fadeIn ?? 0
  const fo = ef.fadeOut ?? 0
  if (fi > 0 && el < fi) alpha = Math.min(alpha, el / fi)
  if (fo > 0 && el > dur - fo) alpha = Math.min(alpha, (dur - el) / fo)
  return Math.max(0, Math.min(1, alpha))
}

function hexToRgbArr(hex) {
  const h = String(hex || '#888888')
    .replace('#', '')
    .padEnd(6, '0')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function lerpRgbArr(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ]
}

function getEffectiveColorRgb(
  effects,
  frame,
  basePathHex,
  baseBallHex,
  settings,
  baseBgHex,
) {
  let pathRgb = hexToRgbArr(basePathHex)
  let ballRgb = hexToRgbArr(baseBallHex)
  let bgRgb = null
  if (settings && settings.effectsColorEnabled === false)
    return { pathRgb, ballRgb, bgRgb }
  for (const ef of effects) {
    if (ef.type !== 'pathColor') continue
    const alpha = getEffectFadeAlpha(ef, frame)
    if (alpha <= 0) continue
    if (ef.pathColor)
      pathRgb = lerpRgbArr(pathRgb, hexToRgbArr(ef.pathColor), alpha)
    if (ef.ballColor)
      ballRgb = lerpRgbArr(ballRgb, hexToRgbArr(ef.ballColor), alpha)
    if (ef.bgColor) {
      const base = bgRgb || hexToRgbArr(baseBgHex || '#0a0b0f')
      bgRgb = lerpRgbArr(base, hexToRgbArr(ef.bgColor), alpha)
    }
  }
  return { pathRgb, ballRgb, bgRgb }
}

// ── HTML Builders ────────────────────────────────────────────────────────────

/**
 * Builds the video-wrap HTML (the <video>, optional loading overlays, and the
 * BounceX canvas wrapper). Used by both buildPlayerHTML and buildPlaylistHTML.
 *
 * @param {object} opts
 * @param {string|null} opts.videoSrc       - Inline video src (null for playlist)
 * @param {boolean}     opts.hasLoadingOverlays - Include loading/buffering/seeking overlays
 */
function buildVideoWrapHTML({
  videoSrc = null,
  hasLoadingOverlays = false,
} = {}) {
  const sourceTag = videoSrc
    ? `<source src="${escHtml(videoSrc)}" type="video/mp4">`
    : ''
  const preload = hasLoadingOverlays ? 'auto' : 'metadata'

  const overlaysHtml = hasLoadingOverlays
    ? `
        <div class="video-overlay video-loading-overlay" id="videoLoadingOverlay">
          <span class="video-overlay-spinner"></span>
          <span class="video-overlay-text" id="videoLoadingProgressText">Loading video…</span>
          <div class="video-loading-progress" id="videoLoadingProgress">
            <div class="video-loading-progress-bar">
              <div class="video-loading-progress-fill" id="videoLoadingProgressFill"></div>
            </div>
          </div>
          <span class="video-overlay-hint">Large files may take a while. If it stays on "Loading metadata…", the file may need remuxing with faststart.</span>
        </div>
        <div class="video-overlay video-buffering-overlay" id="videoBufferingOverlay" aria-hidden="true">
          <span class="video-overlay-spinner"></span>
          <span class="video-overlay-text">Buffering…</span>
        </div>
        <div class="video-overlay video-seeking-overlay" id="videoSeekingOverlay" aria-hidden="true">
          <span class="video-overlay-spinner"></span>
          <span class="video-overlay-text" id="videoSeekingOverlayText">Seeking…</span>
          <span class="video-overlay-hint video-seeking-hint" id="videoSeekingOverlayHint" aria-hidden="true">Previously watched parts may need to load again.</span>
        </div>`
    : ''

  return `
      <div class="player-video-wrap" id="videoWrap">
        <video id="mainVideo" preload="${preload}">${sourceTag}</video>
        ${overlaysHtml}
        <div class="bouncex-wrap" id="bxWrap">
          <canvas class="bouncex-canvas" id="bxCanvas"></canvas>
        </div>
      </div>`
}

/**
 * Builds the player controls HTML (progress bar + controls row).
 * Used by both buildPlayerHTML and buildPlaylistHTML.
 *
 * @param {object} opts
 * @param {boolean} opts.hasPrevNext   - Include prev/next track buttons (playlist)
 * @param {boolean} opts.hasFlipY      - Include flip-Y button (single player)
 * @param {string}  opts.bxSelectHtml  - Optional bx-file <select> HTML (single player)
 * @param {number|null} opts.totalCount - Total tracks for trackDisplay (playlist)
 * @param {string}  opts.duration      - Initial duration string for timeDisplay
 */
function buildControlsHTML({
  hasPrevNext = false,
  hasFlipY = false,
  bxSelectHtml = '',
  totalCount = null,
  duration = '00:00',
} = {}) {
  const prevBtn = hasPrevNext
    ? `
          <button class="ctrl-btn" id="btnPrevTrack" title="Previous video">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="19,20 9,12 19,4"/><line x1="5" y1="4" x2="5" y2="20"/>
            </svg>
          </button>`
    : ''

  const nextBtn = hasPrevNext
    ? `
          <button class="ctrl-btn" id="btnNextTrack" title="Next video">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="5,4 15,12 5,20"/><line x1="19" y1="4" x2="19" y2="20"/>
            </svg>
          </button>`
    : ''

  const trackDisplay =
    hasPrevNext && totalCount !== null
      ? `
          <span class="time-display" style="color:var(--text3)" id="trackDisplay">1 / ${totalCount}</span>`
      : ''

  const flipYBtn = hasFlipY
    ? `
          <button class="overlay-toggle-btn" id="flipYBtn" title="Flip waveform Y axis (depth 1 = bottom)">flip Y: off</button>`
    : ''

  return `
      <div class="player-controls">
        <div class="progress-bar-wrap" id="progressWrap">
          <div class="progress-bar-fill" id="progressFill"></div>
          <div class="progress-bar-thumb" id="progressThumb"></div>
        </div>

        <!-- Primary row: transport + time + fullscreen -->
        <div class="controls-row">
          ${prevBtn}
          <button class="ctrl-btn" id="btnRewind" title="Rewind 5s">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="11,17 6,12 11,7"/><polyline points="18,17 13,12 18,7"/>
            </svg>
          </button>
          <button class="ctrl-btn play-btn" id="btnPlay" title="Play / Pause">
            <svg viewBox="0 0 24 24" fill="currentColor" id="playIcon">
              <polygon points="5,3 19,12 5,21"/>
            </svg>
          </button>
          <button class="ctrl-btn" id="btnForward" title="Forward 5s">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="13,17 18,12 13,7"/><polyline points="6,17 11,12 6,7"/>
            </svg>
          </button>
          ${nextBtn}

          <span class="time-display" id="timeDisplay">00:00 / ${duration}</span>
          ${trackDisplay}

          <div class="controls-spacer"></div>

          <button class="ctrl-btn" id="btnTheater" title="Theater mode">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="theaterIcon">
              <rect x="2" y="4" width="20" height="16" rx="2"/>
              <rect x="5" y="7" width="14" height="10" rx="1" fill="currentColor" stroke="none" opacity="0.35"/>
            </svg>
          </button>
          <button class="ctrl-btn" id="btnFullscreen" title="Fullscreen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/>
              <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
            </svg>
          </button>
        </div>

        <!-- Secondary row: overlay toggles, zoom, volume -->
        <div class="controls-row controls-row-secondary">
          <button class="overlay-toggle-btn" id="overlayBtn" title="Toggle BounceX overlay">overlay: off</button>
          <button class="overlay-toggle-btn" id="overlayBgBtn" title="Toggle overlay background" style="display:none">bg: off</button>
          ${flipYBtn}
          <span id="bxSelectWrap">${bxSelectHtml}</span>

          <div class="controls-spacer"></div>

          <div class="volume-wrap zoom-wrap">
            <span style="font-family:var(--mono);font-size:0.68rem;color:var(--text3);letter-spacing:0.04em;white-space:nowrap">zoom</span>
            <input type="range" class="zoom-slider" id="zoomSlider" min="0.05" max="0.50" step="0.05" value="0.25">
          </div>

          <div class="volume-wrap zoom-wrap">
            <span style="font-family:var(--mono);font-size:0.68rem;color:var(--text3);letter-spacing:0.04em;white-space:nowrap">speed</span>
            <input type="range" class="zoom-slider" id="speedSlider" min="0.5" max="4.0" step="0.25" value="1.0">
          </div>

          <div class="volume-wrap">
            <button class="ctrl-btn" id="btnMute" title="Mute">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" id="volIcon">
                <polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/>
                <path d="M15.54,8.46a5,5,0,0,1,0,7.07"/>
                <path d="M19.07,4.93a10,10,0,0,1,0,14.14"/>
              </svg>
            </button>
            <input type="range" class="volume-slider" id="volumeSlider" min="0" max="1" step="0.01" value="1">
          </div>
        </div>
      </div>`
}

// ── Player Engine ─────────────────────────────────────────────────────────────
//
// createPlayerEngine(opts) wires all shared player behaviour and returns a
// small API for the caller to drive per-mode differences.
//
// Required opts:
//   video        <HTMLVideoElement>
//   canvas       <HTMLCanvasElement>
//   bxWrap       <HTMLElement>         the .bouncex-wrap div
//   userSettings object                from getSettings()
//
// Optional opts:
//   offsetSecs   number               seconds before path starts (default 0)
//   onEnded()                called when video ends (playlist: advance track)
//   onFrame(frame, depth)    called every rAF with current integer frame + depth
//   onSeeking()              called when video.seeking fires (show seeking overlay)
//   onSeeked()               called when video.seeked fires (hide seeking overlay)
//   onCanPlay()              called on first canplay (hide loading overlay)
//   onWaiting()              called on waiting (show buffering overlay)
//   onPlaying()              called on playing (hide buffering overlay)
//   onProgress()             called on progress/loadedmetadata (update load bar)
//
// Returned API:
//   loadBxData(path, totalFrames, effects, peaks)  swap in new path data + bx2 effects + DH peak frames
//   resetSmoothTime()              reset smooth-time to 0 (playlist: each track)
//   resizeCanvas()                 force a canvas resize (playlist: after loadTrack)
//   setOffset(secs)                update path start offset in seconds

function createPlayerEngine(opts) {
  const {
    video,
    canvas,
    bxWrap,
    userSettings,
    onEnded,
    onFrame,
    onSeeking,
    onSeeked,
    onCanPlay,
    onWaiting,
    onPlaying,
    onProgress,
  } = opts

  let offsetSecs = typeof opts.offsetSecs === 'number' ? opts.offsetSecs : 0

  const ctx = canvas.getContext('2d')

  // DOM refs — all must exist in the page by the time this runs
  const overlayBtn = document.getElementById('overlayBtn')
  const overlayBgBtn = document.getElementById('overlayBgBtn')
  const progressFill = document.getElementById('progressFill')
  const progressThumb = document.getElementById('progressThumb')
  const timeDisplay = document.getElementById('timeDisplay')
  const btnPlay = document.getElementById('btnPlay')
  const playIcon = document.getElementById('playIcon')
  const btnRewind = document.getElementById('btnRewind')
  const btnForward = document.getElementById('btnForward')
  const btnMute = document.getElementById('btnMute')
  const volIcon = document.getElementById('volIcon')
  const volumeSlider = document.getElementById('volumeSlider')
  const btnFullscreen = document.getElementById('btnFullscreen')
  const btnTheater = document.getElementById('btnTheater')
  const progressWrap = document.getElementById('progressWrap')
  const zoomSliderEl = document.getElementById('zoomSlider')
  const speedSliderEl = document.getElementById('speedSlider')
  const flipYBtn = document.getElementById('flipYBtn') // null in playlist

  const COLORS = buildColors(userSettings)

  // Mutable state
  let activePath = null
  let activeEffects = [] // bx2 effects array for the current path
  let activePeaks = [] // frame numbers of peak markers (for DH mode)
  let totalFrames = 14400
  let smoothTime = 0
  let lastRafTime = null
  let isOverlay = userSettings.defaultOverlay === true
  let overlayBg = userSettings.defaultOverlayBg === true
  let flipY = userSettings.defaultFlipY === true
  let isSeeking = false
  let wasPlayingBeforeSeek = false
  let seekingLongTimer = null
  let scrubbing = false
  let hideControlsTimer = null
  let isTheater = false

  // ── Zoom default ────────────────────────────────────────────────────────────
  const defaultZoom =
    typeof userSettings.defaultZoom === 'number' &&
    userSettings.defaultZoom >= 0.1 &&
    userSettings.defaultZoom <= 1.0
      ? userSettings.defaultZoom
      : 0.45
  zoomSliderEl.value = String(defaultZoom)

  const defaultPathSpeed =
    typeof userSettings.defaultPathSpeed === 'number' &&
    userSettings.defaultPathSpeed >= 0.5 &&
    userSettings.defaultPathSpeed <= 4.0
      ? userSettings.defaultPathSpeed
      : 1.0
  speedSliderEl.value = String(defaultPathSpeed)

  // ── Initial UI state ────────────────────────────────────────────────────────
  overlayBtn.textContent = `overlay: ${isOverlay ? 'on' : 'off'}`
  overlayBtn.classList.toggle('active', isOverlay)
  bxWrap.classList.toggle('overlay-mode', isOverlay)
  overlayBgBtn.style.display = isOverlay ? '' : 'none'
  overlayBgBtn.textContent = `bg: ${overlayBg ? 'on' : 'off'}`
  overlayBgBtn.classList.toggle('active', overlayBg)
  if (flipYBtn) {
    flipYBtn.textContent = `flip Y: ${flipY ? 'on' : 'off'}`
    flipYBtn.classList.toggle('active', flipY)
  }

  // ── Volume: restore persisted state ────────────────────────────────────────
  const savedVolume = sessionStorage.getItem('playerVolume')
  const savedMuted = sessionStorage.getItem('playerMuted')
  if (savedVolume !== null) {
    video.volume = parseFloat(savedVolume)
    volumeSlider.value = savedVolume
  }
  if (savedMuted !== null) {
    video.muted = savedMuted === 'true'
    if (video.muted) volumeSlider.value = 0
  }
  updateVolIcon()

  // ── Canvas sizing ───────────────────────────────────────────────────────────
  function isFullscreen() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement)
  }

  function getOverlayRefHeight() {
    return isFullscreen() || isTheater
      ? Math.round(window.innerHeight * 0.35)
      : BX_HEIGHT_OVERLAY
  }

  function resizeCanvas() {
    const w = bxWrap.clientWidth
    let h
    if (!isOverlay) {
      const refH = getOverlayRefHeight()
      const sliderValue = parseFloat(zoomSliderEl.value)
      const waveformPx = Math.min(2 * sliderValue * refH, refH)
      h = Math.round(waveformPx) + 2 * (BALL_R + 2)
    } else if (isFullscreen() || isTheater) {
      h = Math.round(window.innerHeight * 0.35)
    } else {
      h = BX_HEIGHT_OVERLAY
    }
    canvas.width = w || bxWrap.offsetWidth || 800
    canvas.height = h
  }

  // ── Canvas rendering ────────────────────────────────────────────────────────
  function drawBounceX() {
    if (!activePath) return
    const W = canvas.width,
      H = canvas.height
    if (W === 0 || H === 0) return

    ctx.clearRect(0, 0, W, H)

    const curFrameExact = Math.min(
      (smoothTime - offsetSecs) * FPS,
      totalFrames - 1,
    )
    const curFrame = Math.floor(curFrameExact)
    const frac = curFrameExact - curFrame
    const ballX = W / 2
    const sliderValue = parseFloat(zoomSliderEl.value)
    const BALL_MARGIN = BALL_R + 2

    let topY, bottomY
    if (isOverlay) {
      // Overlay: bottom is anchored to canvas bottom; zoom raises the top edge
      bottomY = H - BALL_MARGIN
      topY = Math.max(BALL_MARGIN, H * (1 - 2 * sliderValue))
    } else {
      // Normal: canvas height is already sized to the zoom level by resizeCanvas()
      topY = BALL_MARGIN
      bottomY = H - BALL_MARGIN
    }

    // Clip so nothing renders within EDGE_PAD of the canvas edges
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, EDGE_PAD, W, isOverlay ? H - EDGE_PAD : H - EDGE_PAD * 2)
    ctx.clip()

    const depthA =
      curFrame >= 0 && activePath[curFrame] >= 0 ? activePath[curFrame] : 0
    const depthB =
      curFrame >= 0
        ? activePath[Math.min(curFrame + 1, totalFrames - 1)] >= 0
          ? activePath[Math.min(curFrame + 1, totalFrames - 1)]
          : depthA
        : 0
    const curDepth = depthA + (depthB - depthA) * (curFrame >= 0 ? frac : 0)
    const displayDepth = flipY ? 1 - curDepth : curDepth
    const ballY = bottomY + displayDepth * (topY - bottomY)
    const isNearTop = flipY ? curDepth <= 0.01 : curDepth >= 0.99
    const isNearBottom = flipY ? curDepth >= 0.99 : curDepth <= 0.01
    const isDH = userSettings.dhMode === true

    // Boundary lines
    ctx.lineWidth = 1
    ctx.strokeStyle = !isDH && isNearTop ? COLORS.topActive : COLORS.topLine
    ctx.beginPath()
    ctx.moveTo(0, topY)
    ctx.lineTo(W, topY)
    ctx.stroke()
    ctx.strokeStyle =
      !isDH && isNearBottom ? COLORS.bottomActive : COLORS.bottomLine
    ctx.beginPath()
    ctx.moveTo(0, bottomY)
    ctx.lineTo(W, bottomY)
    ctx.stroke()

    // Waveform path with horizontal fade gradient
    // Per-frame speed integration: each frame's x is computed by accumulating
    // (pxPerFrame * speedAt(f)) from the playhead outward, so only frames inside
    // a speed effect zone get stretched — frames outside stay at normal spacing.
    const basePixPerFrame = PX_PER_FRAME * parseFloat(speedSliderEl.value)

    function viewerSpeedAt(f) {
      if (userSettings.effectsSpeedEnabled === false) return 1.0
      let s = 1.0
      for (const ef of activeEffects) {
        if (ef.type !== 'pathSpeed') continue
        const fade = getEffectFadeAlpha(ef, f)
        if (fade <= 0) continue
        s = 1.0 + ((ef.speed || 1.0) - 1.0) * fade
      }
      return s
    }

    const visRange = Math.ceil(W / basePixPerFrame) + 4
    const viewerXCache = new Map()
    viewerXCache.set(curFrameExact, ballX)

    let xAccR = ballX
    const vMaxF = Math.min(totalFrames - 1, Math.ceil(curFrameExact) + visRange)
    for (let f = Math.ceil(curFrameExact); f <= vMaxF; f++) {
      xAccR += basePixPerFrame * viewerSpeedAt(f - 0.5)
      viewerXCache.set(f, xAccR)
    }
    let xAccL = ballX
    const vMinF = Math.max(0, Math.floor(curFrameExact) - visRange)
    for (let f = Math.floor(curFrameExact); f >= vMinF; f--) {
      if (!viewerXCache.has(f)) {
        xAccL -= basePixPerFrame * viewerSpeedAt(f + 0.5)
        viewerXCache.set(f, xAccL)
      }
    }
    function viewerFrameToX(f) {
      if (viewerXCache.has(f)) return viewerXCache.get(f)
      const fl = Math.floor(f),
        fr = Math.ceil(f)
      const xl =
        viewerXCache.get(fl) ?? ballX + (fl - curFrameExact) * basePixPerFrame
      const xr =
        viewerXCache.get(fr) ?? ballX + (fr - curFrameExact) * basePixPerFrame
      return xl + (xr - xl) * (f - fl)
    }

    const startFrame = vMinF
    const endFrame = vMaxF

    const { pathRgb, ballRgb, bgRgb } = getEffectiveColorRgb(
      activeEffects,
      curFrameExact,
      COLORS.pathColor,
      COLORS.ball,
      userSettings,
      userSettings.bgColor || '#0a0b0f',
    )
    const [pr, pg, pb] = pathRgb

    // Background — use effect bgColor if active, else user setting
    const bgAlpha = userSettings.bgTransparent !== false ? 0.45 : 1.0
    if (!isOverlay) {
      const [bgR, bgG, bgB] =
        bgRgb || hexToRgbArr(userSettings.bgColor || '#0a0b0f')
      ctx.fillStyle = `rgba(${bgR},${bgG},${bgB},${bgAlpha})`
      ctx.fillRect(0, 0, W, H)
    } else if (overlayBg) {
      const [bgR, bgG, bgB] =
        bgRgb || hexToRgbArr(userSettings.bgColor || '#0a0b0f')
      ctx.fillStyle = `rgba(${bgR},${bgG},${bgB},0.45)`
      ctx.fillRect(0, topY, W, H - topY)
    }

    // ── DH Mode ─────────────────────────────────────────────────────────────────
    if (isDH) {
      const midY = (topY + bottomY) / 2
      const circleR = Math.max(BALL_R + 3, (bottomY - topY) * 0.13)

      // Vertical hit line at center
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 5])
      ctx.beginPath()
      ctx.moveTo(ballX, topY + 2)
      ctx.lineTo(ballX, bottomY - 2)
      ctx.stroke()
      ctx.setLineDash([])

      // Static hit ring at center
      ctx.beginPath()
      ctx.arc(ballX, midY, circleR, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'
      ctx.lineWidth = 2
      ctx.stroke()

      // Scrolling peak circles
      for (const pf of activePeaks) {
        const x = viewerFrameToX(pf)
        if (x < -circleR * 4 || x > W + circleR * 4) continue

        const dist = Math.abs(x - ballX)
        const hitFrac = Math.max(0, 1 - dist / (circleR * 5))

        // Glow halo when near hit line
        if (hitFrac > 0) {
          const glow = ctx.createRadialGradient(
            x,
            midY,
            0,
            x,
            midY,
            circleR * 3.5,
          )
          glow.addColorStop(0, `rgba(${pr},${pg},${pb},${0.32 * hitFrac})`)
          glow.addColorStop(1, `rgba(${pr},${pg},${pb},0)`)
          ctx.beginPath()
          ctx.arc(x, midY, circleR * 3.5, 0, Math.PI * 2)
          ctx.fillStyle = glow
          ctx.fill()
        }

        // Fill circle progressively as it approaches hit line
        if (hitFrac > 0.4) {
          ctx.beginPath()
          ctx.arc(x, midY, circleR, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${pr},${pg},${pb},${((hitFrac - 0.4) / 0.6) * 0.85})`
          ctx.fill()
        }

        // Circle outline — brighter when near
        ctx.beginPath()
        ctx.arc(x, midY, circleR, 0, Math.PI * 2)
        ctx.strokeStyle = `rgba(${pr},${pg},${pb},${0.45 + hitFrac * 0.55})`
        ctx.lineWidth = 2.5
        ctx.stroke()
      }
    } else {
      // ── Normal waveform ──────────────────────────────────────────────────────────
      const pathGrad = ctx.createLinearGradient(0, 0, W, 0)
      pathGrad.addColorStop(0, `rgba(${pr},${pg},${pb},0)`)
      pathGrad.addColorStop(0.15, `rgba(${pr},${pg},${pb},0.6)`)
      pathGrad.addColorStop(0.45, `rgba(${pr},${pg},${pb},1)`)
      pathGrad.addColorStop(0.55, `rgba(${pr},${pg},${pb},1)`)
      pathGrad.addColorStop(0.85, `rgba(${pr},${pg},${pb},0.6)`)
      pathGrad.addColorStop(1, `rgba(${pr},${pg},${pb},0)`)

      ctx.strokeStyle = pathGrad
      ctx.lineWidth = 2.5
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()
      let pathStarted = false
      for (let f = startFrame; f <= endFrame; f++) {
        const d = activePath[f]
        if (d < 0) continue
        const x = viewerFrameToX(f)
        const displayD = flipY ? 1 - d : d
        const y = bottomY + displayD * (topY - bottomY)
        if (!pathStarted) {
          ctx.moveTo(x, y)
          pathStarted = true
        } else ctx.lineTo(x, y)
      }
      if (pathStarted) ctx.stroke()

      // Ball glow
      const glowGrad = ctx.createRadialGradient(
        ballX,
        ballY,
        0,
        ballX,
        ballY,
        BALL_R * 3,
      )
      glowGrad.addColorStop(0, 'rgba(255,255,255,0.35)')
      glowGrad.addColorStop(1, 'rgba(255,255,255,0)')
      ctx.beginPath()
      ctx.arc(ballX, ballY, BALL_R * 3, 0, Math.PI * 2)
      ctx.fillStyle = glowGrad
      ctx.fill()

      // Ball
      ctx.beginPath()
      ctx.arc(ballX, ballY, BALL_R, 0, Math.PI * 2)
      ctx.fillStyle = `rgb(${ballRgb[0]},${ballRgb[1]},${ballRgb[2]})`
      ctx.fill()
    } // end normal waveform / DH mode branch

    // Playhead line (outside clip, spans full height)
    ctx.restore()
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(ballX, 0)
    ctx.lineTo(ballX, H)
    ctx.stroke()
    ctx.setLineDash([])

    // ── Text effects (bx2) ────────────────────────────────────────────────────
    if (userSettings.effectsTextEnabled !== false) {
      for (const ef of activeEffects) {
        if (ef.type !== 'text') continue
        const fadeAlpha =
          getEffectFadeAlpha(ef, curFrameExact) * (ef.opacity ?? 1)
        if (fadeAlpha <= 0) continue
        const fontFamily = ef.font || 'sans-serif'
        // pathAreaH = bottomY - topY; font scales with it so overlay/zoom work
        const pathAreaH = bottomY - topY
        let actualFontSize = Math.max(
          4,
          Math.round(((ef.fontSize || 50) / 100) * pathAreaH),
        )
        const tx = W * ((ef.posX ?? 50) / 100)
        const ty = topY + pathAreaH * ((ef.posY ?? 50) / 100)
        ctx.save()
        ctx.globalAlpha = fadeAlpha
        ctx.textAlign = 'center'
        ctx.textBaseline = 'alphabetic'
        ctx.fillStyle = ef.color || '#ffffff'
        ctx.shadowColor = 'rgba(0,0,0,0.8)'

        const lines = String(ef.text || '').split('\n')
        const maxAllowedW = W * 0.92 // 4% margin each side

        // Measure at nominal size, shrink font if widest line overflows
        ctx.font = `${actualFontSize}px '${fontFamily}', 'JetBrains Mono', sans-serif`
        const widestLine = lines.reduce(
          (max, l) => Math.max(max, ctx.measureText(l).width),
          0,
        )
        if (widestLine > maxAllowedW) {
          actualFontSize = Math.max(
            4,
            Math.floor((actualFontSize * maxAllowedW) / widestLine),
          )
          ctx.font = `${actualFontSize}px '${fontFamily}', 'JetBrains Mono', sans-serif`
        }

        ctx.shadowBlur = Math.max(2, Math.ceil(actualFontSize / 10))
        // Use actual glyph metrics for precise vertical centering
        const m = ctx.measureText('Ag')
        const vAsc = m.actualBoundingBoxAscent ?? actualFontSize * 0.72
        const vDesc = m.actualBoundingBoxDescent ?? actualFontSize * 0.18
        const baselineAdjust = vAsc - (vAsc + vDesc) / 2
        const lineH = actualFontSize * 1.25
        const strokeW =
          (ef.strokeWidth || 0) > 0
            ? (ef.strokeWidth / 100) * actualFontSize * 2
            : 0
        lines.forEach((line, li) => {
          const lineCenterY = ty + (li - (lines.length - 1) / 2) * lineH
          if (strokeW > 0) {
            ctx.strokeStyle = ef.strokeColor || '#000000'
            ctx.lineWidth = strokeW
            ctx.lineJoin = 'round'
            ctx.shadowBlur = 0
            ctx.strokeText(line, tx, lineCenterY + baselineAdjust)
            ctx.shadowBlur = Math.max(2, Math.ceil(actualFontSize / 10))
          }
          ctx.fillText(line, tx, lineCenterY + baselineAdjust)
        })
        ctx.restore()
      }
    }

    if (onFrame) onFrame(curFrame, curDepth)
  }

  // ── RAF loop ────────────────────────────────────────────────────────────────
  function loop(rafTime) {
    if (!isSeeking) {
      if (!video.paused && !video.ended) {
        if (lastRafTime !== null) {
          const delta = (rafTime - lastRafTime) / 1000
          smoothTime += delta
          if (Math.abs(smoothTime - video.currentTime) > 0.1)
            smoothTime = video.currentTime
        } else {
          smoothTime = video.currentTime
        }
      } else {
        smoothTime = video.currentTime
      }
    }
    lastRafTime = rafTime

    const t = isSeeking ? smoothTime : video.currentTime || 0
    const dur = video.duration || totalFrames / FPS
    const pct = dur > 0 ? (t / dur) * 100 : 0
    progressFill.style.width = `${pct}%`
    progressThumb.style.left = `${pct}%`
    timeDisplay.textContent = `${framesToTimecode(Math.floor(t * FPS))} / ${framesToTimecode(totalFrames)}`

    drawBounceX()
    requestAnimationFrame(loop)
  }

  // ── Overlay toggles ─────────────────────────────────────────────────────────
  overlayBtn.addEventListener('click', () => {
    isOverlay = !isOverlay
    overlayBtn.textContent = `overlay: ${isOverlay ? 'on' : 'off'}`
    overlayBtn.classList.toggle('active', isOverlay)
    bxWrap.classList.toggle('overlay-mode', isOverlay)
    overlayBgBtn.style.display = isOverlay ? '' : 'none'
    resizeCanvas()
    if (isFullscreen()) anchorOverlay()
  })

  overlayBgBtn.addEventListener('click', () => {
    overlayBg = !overlayBg
    overlayBgBtn.textContent = `bg: ${overlayBg ? 'on' : 'off'}`
    overlayBgBtn.classList.toggle('active', overlayBg)
  })

  if (flipYBtn) {
    flipYBtn.addEventListener('click', () => {
      flipY = !flipY
      flipYBtn.textContent = `flip Y: ${flipY ? 'on' : 'off'}`
      flipYBtn.classList.toggle('active', flipY)
    })
  }

  zoomSliderEl.addEventListener('input', () => {
    if (!isOverlay) resizeCanvas()
  })

  // ── Playback controls ───────────────────────────────────────────────────────
  function togglePlay() {
    if (video.paused) video.play()
    else video.pause()
  }

  btnPlay.addEventListener('click', togglePlay)

  video.addEventListener('play', () => {
    playIcon.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`
    playIcon.setAttribute('fill', 'currentColor')
  })
  video.addEventListener('pause', () => {
    playIcon.innerHTML = `<polygon points="5,3 19,12 5,21"/>`
  })
  video.addEventListener('ended', () => {
    playIcon.innerHTML = `<polygon points="5,3 19,12 5,21"/>`
    if (onEnded) onEnded()
  })

  btnRewind.addEventListener('click', () => {
    video.currentTime = Math.max(0, video.currentTime - 5)
  })
  btnForward.addEventListener('click', () => {
    video.currentTime = Math.min(video.duration || 0, video.currentTime + 5)
  })

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return
    if (e.code === 'Space') {
      e.preventDefault()
      togglePlay()
    }
    if (e.code === 'ArrowLeft')
      video.currentTime = Math.max(0, video.currentTime - 5)
    if (e.code === 'ArrowRight')
      video.currentTime = Math.min(video.duration || 0, video.currentTime + 5)
  })

  // ── Video state events ──────────────────────────────────────────────────────
  video.addEventListener('seeking', () => {
    isSeeking = true
    wasPlayingBeforeSeek = !video.paused
    video.pause()
    clearTimeout(seekingLongTimer)
    seekingLongTimer = setTimeout(() => {
      seekingLongTimer = null
    }, 2500)
    if (onSeeking) onSeeking()
  })

  video.addEventListener('seeked', () => {
    clearTimeout(seekingLongTimer)
    seekingLongTimer = null
    isSeeking = false
    smoothTime = video.currentTime || 0
    if (wasPlayingBeforeSeek) video.play()
    if (onSeeked) onSeeked()
  })

  if (onCanPlay) video.addEventListener('canplay', onCanPlay)
  if (onWaiting) video.addEventListener('waiting', onWaiting)
  if (onPlaying) video.addEventListener('playing', onPlaying)
  if (onProgress) {
    video.addEventListener('progress', onProgress)
    video.addEventListener('loadedmetadata', onProgress)
  }

  // ── Volume ──────────────────────────────────────────────────────────────────
  volumeSlider.addEventListener('input', () => {
    video.volume = parseFloat(volumeSlider.value)
    video.muted = video.volume === 0
    sessionStorage.setItem('playerVolume', volumeSlider.value)
    sessionStorage.setItem('playerMuted', String(video.muted))
    updateVolIcon()
  })

  btnMute.addEventListener('click', () => {
    video.muted = !video.muted
    volumeSlider.value = video.muted ? 0 : video.volume
    sessionStorage.setItem('playerMuted', String(video.muted))
    sessionStorage.setItem('playerVolume', String(video.volume))
    updateVolIcon()
  })

  function updateVolIcon() {
    if (video.muted || video.volume === 0) {
      volIcon.innerHTML = `<polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>`
    } else {
      volIcon.innerHTML = `<polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54,8.46a5,5,0,0,1,0,7.07"/><path d="M19.07,4.93a10,10,0,0,1,0,14.14"/>`
    }
  }

  // ── Progress bar scrubbing ──────────────────────────────────────────────────
  function seekTo(clientX) {
    const rect = progressWrap.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    video.currentTime = pct * (video.duration || 0)
  }

  progressWrap.addEventListener('mousedown', (e) => {
    scrubbing = true
    seekTo(e.clientX)
  })
  document.addEventListener('mousemove', (e) => {
    if (scrubbing) seekTo(e.clientX)
  })
  document.addEventListener('mouseup', () => {
    scrubbing = false
  })

  progressWrap.addEventListener(
    'touchstart',
    (e) => {
      scrubbing = true
      if (e.touches.length) seekTo(e.touches[0].clientX)
    },
    { passive: true },
  )
  document.addEventListener(
    'touchmove',
    (e) => {
      if (scrubbing && e.touches.length) seekTo(e.touches[0].clientX)
    },
    { passive: true },
  )
  document.addEventListener('touchend', () => {
    scrubbing = false
  })

  // ── Fullscreen ──────────────────────────────────────────────────────────────
  function anchorOverlay() {
    bxWrap.style.bottom = ''
  }

  function isImmersive() {
    return isFullscreen() || isTheater
  }

  function showControls() {
    const container = document.getElementById('playerContainer')
    const controls = container.querySelector('.player-controls')
    container.classList.add('controls-visible')
    if (controls) controls.classList.add('controls-visible')
    anchorOverlay()
    clearTimeout(hideControlsTimer)
    hideControlsTimer = setTimeout(() => {
      if (isImmersive()) {
        container.classList.remove('controls-visible')
        if (controls) controls.classList.remove('controls-visible')
        anchorOverlay()
      }
    }, 1000)
  }

  function hideControlsNow() {
    const container = document.getElementById('playerContainer')
    const controls = container.querySelector('.player-controls')
    clearTimeout(hideControlsTimer)
    container.classList.remove('controls-visible')
    if (controls) controls.classList.remove('controls-visible')
    anchorOverlay()
  }

  function onEnterFullscreen() {
    const container = document.getElementById('playerContainer')
    container.classList.add('fullscreen-active')
    // Double-rAF: first frame browser applies fullscreen UA styles;
    // second frame layout is stable and getBoundingClientRect is reliable.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        resizeCanvas()
        showControls()
      }),
    )
  }

  function onExitFullscreen() {
    const container = document.getElementById('playerContainer')
    container.classList.remove('fullscreen-active', 'controls-visible')
    const controls = container.querySelector('.player-controls')
    if (controls) controls.classList.remove('controls-visible')
    clearTimeout(hideControlsTimer)
    bxWrap.style.bottom = ''
    resizeCanvas()
  }

  btnFullscreen.addEventListener('click', () => {
    const container = document.getElementById('playerContainer')
    if (!isFullscreen()) {
      const req =
        container.requestFullscreen || container.webkitRequestFullscreen
      if (req) req.call(container).catch(() => {})
    } else {
      const exit = document.exitFullscreen || document.webkitExitFullscreen
      if (exit) exit.call(document)
    }
  })

  document.addEventListener('fullscreenchange', () => {
    document.fullscreenElement ? onEnterFullscreen() : onExitFullscreen()
  })
  document.addEventListener('webkitfullscreenchange', () => {
    document.webkitFullscreenElement ? onEnterFullscreen() : onExitFullscreen()
  })

  // ── Theater mode ─────────────────────────────────────────────────────────────

  function enterTheater() {
    isTheater = true
    document.body.classList.remove('theater-mode') // reset to replay animation
    void document.body.offsetWidth // force reflow
    document.body.classList.add('theater-mode')
    if (btnTheater) btnTheater.classList.add('active')
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        resizeCanvas()
        showControls()
      }),
    )
  }

  function exitTheater() {
    isTheater = false
    document.body.classList.remove('theater-mode')
    if (btnTheater) btnTheater.classList.remove('active')
    clearTimeout(hideControlsTimer)
    const container = document.getElementById('playerContainer')
    const controls = container.querySelector('.player-controls')
    container.classList.remove('controls-visible')
    if (controls) controls.classList.remove('controls-visible')
    requestAnimationFrame(() => requestAnimationFrame(() => resizeCanvas()))
  }

  if (btnTheater) {
    btnTheater.addEventListener('click', () => {
      isTheater ? exitTheater() : enterTheater()
    })
  }

  document.addEventListener('keydown', (e) => {
    if (
      e.target.tagName === 'INPUT' ||
      e.target.tagName === 'TEXTAREA' ||
      e.target.tagName === 'SELECT'
    )
      return
    if (e.key === 't' || e.key === 'T') {
      isTheater ? exitTheater() : enterTheater()
    }
    if (e.key === 'Escape' && isTheater) {
      exitTheater()
    }
  })

  document.addEventListener('mousemove', () => {
    if (isFullscreen()) showControls()
    else if (isTheater) showControls()
  })
  document.addEventListener(
    'touchstart',
    () => {
      if (isFullscreen()) showControls()
    },
    { passive: true },
  )

  // ── ResizeObserver + start loop ─────────────────────────────────────────────
  new ResizeObserver(resizeCanvas).observe(bxWrap)
  resizeCanvas()
  requestAnimationFrame(loop)

  // ── Public API ──────────────────────────────────────────────────────────────
  return {
    /** Swap in new bx path data (used by playlist on each track change). */
    loadBxData(path, frames, effects = [], peaks = []) {
      activePath = path
      totalFrames = frames
      activeEffects = Array.isArray(effects) ? effects : []

      // If peaks were explicitly provided, use them. Otherwise auto-derive from
      // the path by finding local extrema (bounce points where direction reverses).
      if (Array.isArray(peaks) && peaks.length > 0) {
        activePeaks = peaks
      } else if (path && path.length > 0) {
        const derived = []
        let prevDir = 0
        for (let f = 1; f < path.length - 1; f++) {
          if (path[f] < 0 || path[f - 1] < 0) {
            prevDir = 0
            continue
          }
          const dir = Math.sign(path[f] - path[f - 1])
          if (dir !== 0 && prevDir !== 0 && dir !== prevDir) derived.push(f)
          if (dir !== 0) prevDir = dir
        }
        activePeaks = derived
      } else {
        activePeaks = []
      }
    },
    /** Reset smooth-time interpolation (used by playlist on each track change). */
    resetSmoothTime() {
      smoothTime = 0
      lastRafTime = null
    },
    /** Imperatively resize the canvas (used by playlist after loadTrack). */
    resizeCanvas,
    /** Update the path start offset in seconds (0 = no offset). */
    setOffset(secs) {
      offsetSecs = typeof secs === 'number' && secs > 0 ? secs : 0
    },
  }
}
