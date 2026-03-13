/**
 * BounceX Viewer — Playlist Player
 *
 * Handles playlist mode (playlist.html?p=...).
 * All shared rendering/controls logic lives in player-core.js.
 * This file is responsible for:
 *   - Loading the playlist JSON and all video metas
 *   - Building the playlist page HTML (player + track sidebar)
 *   - Track navigation (prev/next, click-to-jump, auto-advance)
 *   - Updating the info panel on track change
 */

const PLAYLIST_BASE = 'playlists'

const playlistParams = new URLSearchParams(window.location.search)
const playlistId = playlistParams.get('p')

if (!playlistId) {
  document.getElementById('playerLayout').innerHTML =
    '<div class="error-msg">No playlist specified. <a href="index.html" style="color:var(--accent)">Browse</a></div>'
} else {
  loadPlaylist(playlistId)
}

// ── Load & Initialise ─────────────────────────────────────────────────────────

async function loadPlaylist(id) {
  const layout = document.getElementById('playerLayout')
  try {
    const playlist = await fetchJSON(
      `${PLAYLIST_BASE}/${encodeURIComponent(id)}/meta.json`,
    )
    const videos = playlist.videos || []

    if (videos.length === 0) {
      layout.innerHTML =
        '<div class="error-msg">This playlist has no videos.</div>'
      return
    }

    const metas = await Promise.all(
      videos.map((entry) => {
        const folder =
          typeof entry === 'string' ? entry : entry.id || entry.videoId
        const bxOverride =
          typeof entry === 'string' ? null : entry.bxFile || null
        return fetchJSON(
          `${VIDEO_BASE}/${encodeURIComponent(folder)}/meta.json`,
        ).then((m) => ({
          ...m,
          _folder: folder,
          _bxFile: bxOverride,
        }))
      }),
    )

    document.title = `${playlist.title || id} — BounceX Viewer`

    layout.innerHTML = buildPlaylistHTML(playlist, metas)
    setupPlaylistPlayer(playlist, metas)
  } catch (e) {
    layout.innerHTML = `<div class="error-msg">Failed to load playlist.<br><small>${escHtml(e.message)}</small></div>`
    console.error(e)
  }
}

// ── HTML Builder ─────────────────────────────────────────────────────────────

// Render video description (handles both string and array formats)
function renderVideoDescription(meta) {
  if (!meta.description) return ''
  return Array.isArray(meta.description)
    ? meta.description
        .map((p) => `<p class="video-description">${renderDescription(p)}</p>`)
        .join('')
    : `<p class="video-description">${renderDescription(meta.description)}</p>`
}

// Update video description DOM element
function updateVideoDescription(meta) {
  const container = document.getElementById('videoDescContainer')
  if (!container) return
  container.innerHTML = renderVideoDescription(meta)
}

function buildPlaylistHTML(playlist, metas) {
  const trackerItems = metas
    .map((m, i) => {
      const folder = m._folder
      const thumbSrc = m.thumbnail
        ? `${VIDEO_BASE}/${encodeURIComponent(folder)}/${encodeURIComponent(m.thumbnail)}`
        : null
      const timecode = framesToTimecode(m.duration || 0)
      return `
      <div class="playlist-track-item" id="ptrack-${i}" data-index="${i}">
        <div class="ptrack-num">${i + 1}</div>
        <div class="ptrack-thumb">
          ${
            thumbSrc
              ? `<img src="${thumbSrc}" alt="" loading="lazy" onerror="this.style.display='none'">`
              : `<div class="ptrack-thumb-placeholder"></div>`
          }
        </div>
        <div class="ptrack-info">
          <div class="ptrack-title">${escHtml(m.title || folder)}</div>
          <div class="ptrack-author">${escHtml(m.pathCreator || 'Unknown')}</div>
        </div>
        <div class="ptrack-duration">${timecode}</div>
      </div>`
    })
    .join('')

  return `
  <div class="player-main">
    <a href="index.html" class="back-btn">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="10,3 5,8 10,13"/>
      </svg>
      Back to browse
    </a>

    <div class="player-container" id="playerContainer">
      ${buildVideoWrapHTML({ hasLoadingOverlays: false })}
      ${buildControlsHTML({ hasPrevNext: true, hasFlipY: true, totalCount: metas.length })}
    </div>

    <div class="video-info">
      <h1 class="video-title" id="plCurrentTitle">${escHtml(metas[0].title || metas[0]._folder)}</h1>
      <div class="video-creator-row" id="plCurrentAuthors">
        <div class="video-creator"><span class="video-creator-label">Video Creator</span>${escHtml(metas[0].videoCreator || 'Unknown')}</div>
        <div class="video-creator"><span class="video-creator-label">Path Creator</span>${escHtml(metas[0].pathCreator || 'Unknown')}</div>
      </div>
      <div class="video-stats-row">
        <div class="stat-item"><span class="stat-label">Playlist</span><span class="stat-value">${escHtml(playlist.title || playlistId)}</span></div>
        <div class="stat-item"><span class="stat-label">Videos</span><span class="stat-value">${metas.length}</span></div>
        <div class="stat-item"><span class="stat-label">Track</span><span class="stat-value" id="plTrackNum">1 / ${metas.length}</span></div>
      </div>
      <div id="videoDescContainer">
        ${
          metas[0].description
            ? Array.isArray(metas[0].description)
              ? metas[0].description
                  .map(
                    (p) =>
                      `<p class="video-description">${renderDescription(p)}</p>`,
                  )
                  .join('')
              : `<p class="video-description">${renderDescription(metas[0].description)}</p>`
            : ''
        }
      </div>
      ${playlist.description
          ? (Array.isArray(playlist.description)
              ? playlist.description.map(p => `<p class="video-description" style="margin-top:1rem">${renderDescription(p)}</p>`).join('')
              : `<p class="video-description" style="margin-top:1rem">${renderDescription(playlist.description)}</p>`)
          : ''}
    </div>
  </div>

  <aside class="player-sidebar">
    <div class="sidebar-section">
      <div class="sidebar-title">${escHtml(playlist.title || 'Playlist')} — ${metas.length} videos</div>
      <div class="playlist-track-list" id="playlistTrackList">
        ${trackerItems}
      </div>
    </div>
  </aside>`
}

// ── Player Setup ─────────────────────────────────────────────────────────────

function setupPlaylistPlayer(playlist, metas) {
  const video = document.getElementById('mainVideo')
  const canvas = document.getElementById('bxCanvas')
  const bxWrap = document.getElementById('bxWrap')

  // Playlist-only DOM refs
  const trackDisplay = document.getElementById('trackDisplay')
  const trackList = document.getElementById('playlistTrackList')
  const btnPrevTrack = document.getElementById('btnPrevTrack')
  const btnNextTrack = document.getElementById('btnNextTrack')

  const userSettings = typeof getSettings === 'function' ? getSettings() : {}

  let currentIndex = 0

  // ── Create shared engine ────────────────────────────────────────────────────
  const engine = createPlayerEngine({
    video,
    canvas,
    bxWrap,
    userSettings,
    onEnded() {
      // Auto-advance to next track
      if (currentIndex < metas.length - 1) loadTrack(currentIndex + 1)
    },
  })

  // ── Track loading ───────────────────────────────────────────────────────────
  async function loadTrack(index) {
    currentIndex = index
    const meta = metas[index]
    const folder = meta._folder

    // Update info panel
    document.getElementById('plCurrentTitle').textContent = meta.title || folder
    const authorsEl = document.getElementById('plCurrentAuthors')
    if (authorsEl) {
      authorsEl.innerHTML = `
        <div class="video-creator"><span class="video-creator-label">Video Creator</span>${escHtml(meta.videoCreator || 'Unknown')}</div>
        <div class="video-creator"><span class="video-creator-label">Path Creator</span>${escHtml(meta.pathCreator || 'Unknown')}</div>`
    }
    document.getElementById('plTrackNum').textContent =
      `${index + 1} / ${metas.length}`
    // Update video description
    updateVideoDescription(meta)
    if (trackDisplay)
      trackDisplay.textContent = `${index + 1} / ${metas.length}`

    // Highlight active track in the sidebar list
    trackList.querySelectorAll('.playlist-track-item').forEach((el, i) => {
      el.classList.toggle('active', i === index)
    })
    const activeEl = document.getElementById(`ptrack-${index}`)
    if (activeEl)
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' })

    // Determine which bx file to load: per-entry override → first bxFiles entry → bxFile
    const bxFileToLoad =
      meta._bxFile ||
      (meta.bxFiles && meta.bxFiles[0] ? meta.bxFiles[0].file : null) ||
      meta.bxFile

    let newPath
    let newTotalFrames = meta.duration || 14400
    try {
      const bxRaw = await fetchText(
        `${VIDEO_BASE}/${encodeURIComponent(folder)}/${encodeURIComponent(bxFileToLoad)}`,
      )
      const markerData = JSON.parse(bxRaw)
      newPath = buildPath(markerData, newTotalFrames)
    } catch (e) {
      console.warn('Could not load bx file:', e)
      newPath = new Float32Array(newTotalFrames).fill(0)
    }

    engine.loadBxData(newPath, newTotalFrames)
    engine.setOffset(typeof meta.offset === 'number' ? meta.offset : 0)
    engine.resetSmoothTime()

    // Rebuild the bx-file dropdown for this track (shown when a track has multiple .bx files)
    const bxSelectWrap = document.getElementById('bxSelectWrap')
    if (bxSelectWrap) {
      const bxSources =
        meta.bxFiles && meta.bxFiles.length > 1 ? meta.bxFiles : null
      if (bxSources) {
        const selectedIdx = bxSources.findIndex((b) => b.file === bxFileToLoad)
        bxSelectWrap.innerHTML = `<select class="bx-select" id="bxSelect">
          ${bxSources.map((b, i) => `<option value="${i}"${i === selectedIdx ? ' selected' : ''}>${escHtml(b.label)}</option>`).join('')}
        </select>`
        document
          .getElementById('bxSelect')
          .addEventListener('change', async (e) => {
            const b = bxSources[parseInt(e.target.value)]
            try {
              const data = JSON.parse(
                await fetchText(
                  `${VIDEO_BASE}/${encodeURIComponent(folder)}/${encodeURIComponent(b.file)}`,
                ),
              )
              engine.loadBxData(buildPath(data, newTotalFrames), newTotalFrames)
            } catch (err) {
              console.warn('Could not load bx file:', err)
            }
          })
      } else {
        bxSelectWrap.innerHTML = ''
      }
    }

    // Load and play the video
    video.src = `${VIDEO_BASE}/${encodeURIComponent(folder)}/${encodeURIComponent(meta.videoFile)}`
    video.load()
    engine.resizeCanvas()
    video.play().catch(() => {})
  }

  // ── Playlist navigation controls ────────────────────────────────────────────
  if (btnPrevTrack) {
    btnPrevTrack.addEventListener('click', () => {
      if (currentIndex > 0) loadTrack(currentIndex - 1)
    })
  }
  if (btnNextTrack) {
    btnNextTrack.addEventListener('click', () => {
      if (currentIndex < metas.length - 1) loadTrack(currentIndex + 1)
    })
  }

  trackList.querySelectorAll('.playlist-track-item').forEach((item) => {
    item.addEventListener('click', () =>
      loadTrack(parseInt(item.dataset.index)),
    )
  })

  // ── Start first track ───────────────────────────────────────────────────────
  loadTrack(0)
}
