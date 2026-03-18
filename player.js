/**
 * BounceX Viewer — Single-Video Player
 *
 * Handles single-video watch mode (watch.html?v=...).
 * All shared rendering/controls logic lives in player-core.js.
 * This file is responsible for:
 *   - Service Worker registration
 *   - Loading video meta + bx files
 *   - Building the single-video page HTML
 *   - Wiring the bx-file dropdown and marker list (single-video only)
 *   - Wiring the video loading/buffering/seeking overlays (single-video only)
 *   - Loading "more videos" sidebar suggestions
 */

// ── Service Worker ────────────────────────────────────────────────────────────

if (typeof navigator !== 'undefined' && navigator.serviceWorker) {
  navigator.serviceWorker.register('sw.js').catch(() => {})
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const params = new URLSearchParams(window.location.search)
const videoId = params.get('v')

// playlist.html also loads player-core.js but not this file, so no guard needed.
if (!videoId) {
  document.getElementById('playerLayout').innerHTML =
    '<div class="error-msg">No video specified. <a href="index.html" style="color:var(--accent)">Browse videos</a></div>'
} else {
  loadPlayer(videoId)
}

// ── Load & Initialise ────────────────────────────────────────────────────────

async function loadPlayer(id) {
  const layout = document.getElementById('playerLayout')
  try {
    // meta.json is optional — fall back to folder-name defaults if absent
    let meta
    try {
      meta = await fetchJSON(`${VIDEO_BASE}/${encodeURIComponent(id)}/meta.json`)
    } catch (e) {
      if (/HTTP 404/.test(e.message)) {
        meta = { title: id, videoFile: `${id}.mp4`, bxFiles: [{ label: 'Default', file: `${id}.bx` }] }
      } else {
        throw e
      }
    }

    // Normalise missing videoFile — assume <folder>.mp4 by convention
    if (!meta.videoFile) meta.videoFile = `${id}.mp4`

    // Normalise legacy single-file field so all downstream code only sees bxFiles
    if (!meta.bxFiles && meta.bxFile) {
      meta.bxFiles = [{ label: 'Default', file: meta.bxFile }]
    }
    if (!meta.bxFiles || meta.bxFiles.length === 0) {
      throw new Error('No bx path file specified in meta.json')
    }

    const bxSources = await Promise.all(
      meta.bxFiles.map(async (b) => {
        const url = `${VIDEO_BASE}/${encodeURIComponent(id)}/${encodeURIComponent(b.file)}`
        const raw = await fetchText(url)
        try {
          const parsed = JSON.parse(raw)
          // Support plain .bx, version:2 at root, and new meta.version structure
          const isBx2 = parsed.version === 2 || parsed.meta?.version === 2
          const markerData = isBx2 ? parsed.markers : parsed
          const effects    = isBx2 && Array.isArray(parsed.effects) ? parsed.effects : []
          return { label: b.label || 'Default', file: b.file, data: markerData, effects }
        } catch (e) {
          throw new Error(`Could not load bx file "${b.file}": ${e.message}`)
        }
      }),
    )

    document.title = `${meta.title || id} – BounceX Viewer`

    // Derive initial frame count from bx data — real value set via loadedmetadata
    const markerData = bxSources[0].data
    const maxBxFrame =
      Object.keys(markerData).reduce((m, k) => Math.max(m, parseInt(k)), 0) + 1
    const initialFrames = Math.max(maxBxFrame, 1)

    const path = buildPath(markerData, initialFrames)
    const markers = markersFromData(markerData)

    layout.innerHTML = buildPlayerHTML(meta, id, markers, bxSources)
    setupPlayer(meta, id, path, markers, initialFrames, bxSources)
    loadMoreVideos(id, meta.tags || [])
  } catch (e) {
    layout.innerHTML = `<div class="error-msg">Failed to load video.<br><small>${escHtml(e.message)}</small></div>`
    console.error(e)
  }
}

/** Parse a raw markerData object into a sorted marker array. */
function markersFromData(markerData) {
  return Object.entries(markerData)
    .map(([k, v]) => ({
      frame: parseInt(k),
      depth: v[0],
      trans: v[1],
      ease: v[2],
      aux: v[3],
    }))
    .sort((a, b) => a.frame - b.frame)
}

// ── HTML Builder ─────────────────────────────────────────────────────────────

function buildPlayerHTML(meta, id, markers, bxSources) {
  const folder = id
  const tags = meta.tags || []
  const highlights = (meta.highlightedTags || []).slice(0, 3)

  const markerRows = markers
    .map(
      (m, i) => `
    <div class="marker-list-item" data-frame="${m.frame}" id="mli-${i}">
      <span class="marker-frame-num">${m.frame}</span>
      <div class="marker-depth-bar">
        <div class="marker-depth-fill" style="width:${(m.depth * 100).toFixed(1)}%"></div>
      </div>
      <span class="marker-depth-val">${m.depth.toFixed(2)}</span>
      <span class="marker-ease-tag">${easeLabel(m.trans, m.ease)}</span>
    </div>`,
    )
    .join('')

  const bxSelectHtml =
    bxSources.length > 1
      ? `<select class="bx-select" id="bxSelect">
        ${bxSources.map((b, i) => `<option value="${i}">${escHtml(b.label)}</option>`).join('')}
       </select>`
      : ''

  return `
  <div class="player-main">
    <a href="index.html" class="back-btn">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="10,3 5,8 10,13"/>
      </svg>
      Back to browse
    </a>

    <div class="player-container" id="playerContainer">
      ${buildVideoWrapHTML({ videoSrc: `${VIDEO_BASE}/${encodeURIComponent(folder)}/${encodeURIComponent(meta.videoFile)}`, hasLoadingOverlays: true })}
      ${buildControlsHTML({ hasFlipY: true, bxSelectHtml, duration: '' })}
    </div>

    <div class="video-info">
      <div class="card-highlight-tags" style="margin-bottom:0.6rem">
        ${highlights.map((t) => `<span class="card-tag">${escHtml(t)}</span>`).join('')}
      </div>
      <h1 class="video-title">${escHtml(meta.title || id)}</h1>
      <div class="video-creator-row">
        <div class="video-creator"><span class="video-creator-label">Video Creator</span>${escHtml(meta.videoCreator || 'Unknown')}</div>
        <div class="video-creator"><span class="video-creator-label">Path Creator</span>${escHtml(meta.pathCreator || 'Unknown')}</div>
      </div>

      <div class="video-stats-row">
        <div class="stat-item"><span class="stat-label">BPM</span><span class="stat-value">${meta.bpm || '–'}</span></div>
        <div class="stat-item"><span class="stat-label">Duration</span><span class="stat-value" id="statDuration">–</span></div>
        <div class="stat-item"><span class="stat-label">Frames</span><span class="stat-value" id="statFrames">–</span></div>
        <div class="stat-item"><span class="stat-label">Markers</span><span class="stat-value" id="statsMarkerCount">${markers.length}</span></div>
      </div>

      ${
        meta.description
          ? Array.isArray(meta.description)
            ? meta.description
                .map(
                  (p) =>
                    `<p class="video-description">${renderDescription(p)}</p>`,
                )
                .join('')
            : `<p class="video-description">${renderDescription(meta.description)}</p>`
          : ''
      }

      <div class="video-tags-section">
        ${tags.map((t) => `<a href="index.html?q=${encodeURIComponent(t)}" class="video-tag">#${escHtml(t)}</a>`).join('')}
      </div>
    </div>
  </div>

  <aside class="player-sidebar">
    <div class="sidebar-tabs">
      <button class="sidebar-tab" id="sidebarTabBx">BounceX Data</button>
      <button class="sidebar-tab active" id="sidebarTabMore">More Videos</button>
    </div>

    <div class="sidebar-panel" id="sidebarPanelBx">
      <div class="sidebar-section">
        <div class="sidebar-title">Stats</div>
        <div class="bx-stats-grid">
          <div class="bx-stat-box"><div class="bx-stat-label">Markers</div><div class="bx-stat-value" id="sidebarMarkerCount">${markers.length}</div></div>
          <div class="bx-stat-box"><div class="bx-stat-label">BX File</div><div class="bx-stat-value" id="sidebarBxFile" style="font-size:0.72rem">${escHtml(bxSources[0].file)}</div></div>
          <div class="bx-stat-box"><div class="bx-stat-label">Current Depth</div><div class="bx-stat-value" id="curDepth">–</div></div>
          <div class="bx-stat-box"><div class="bx-stat-label">Current Frame</div><div class="bx-stat-value" id="curFrame">0</div></div>
        </div>
      </div>

      <div class="sidebar-section">
        <div class="sidebar-title" id="markerListTitle">Markers (${markers.length})</div>
        <div class="marker-list" id="markerList">${markerRows}</div>
      </div>
    </div>

    <div class="sidebar-panel active" id="sidebarPanelMore">
      <div class="more-videos-list" id="moreVideosList">
        <div style="color:var(--text3);font-size:0.75rem;font-family:var(--mono);padding:0.5rem 0">Loading…</div>
      </div>
    </div>
  </aside>`
}

// ── Player Setup ─────────────────────────────────────────────────────────────

function setupPlayer(meta, id, path, markers, totalFrames, bxSources) {
  const video = document.getElementById('mainVideo')
  const canvas = document.getElementById('bxCanvas')
  const bxWrap = document.getElementById('bxWrap')

  // Single-video–only DOM refs
  const videoLoadingOverlay = document.getElementById('videoLoadingOverlay')
  const videoLoadingProgressText = document.getElementById(
    'videoLoadingProgressText',
  )
  const videoLoadingProgressFill = document.getElementById(
    'videoLoadingProgressFill',
  )
  const videoBufferingOverlay = document.getElementById('videoBufferingOverlay')
  const videoSeekingOverlay = document.getElementById('videoSeekingOverlay')
  const videoSeekingOverlayText = document.getElementById(
    'videoSeekingOverlayText',
  )
  const videoSeekingOverlayHint = document.getElementById(
    'videoSeekingOverlayHint',
  )
  const curDepthEl = document.getElementById('curDepth')
  const curFrameEl = document.getElementById('curFrame')
  const markerListEl = document.getElementById('markerList')

  const userSettings = typeof getSettings === 'function' ? getSettings() : {}
  let lastHighlightedMarker = -1
  let hasCanPlayed = false
  let seekingLongTimer = null

  // ── Seeking overlays ────────────────────────────────────────────────────────
  function onSeeking() {
    if (videoSeekingOverlay) videoSeekingOverlay.removeAttribute('aria-hidden')
    if (videoSeekingOverlayText)
      videoSeekingOverlayText.textContent = 'Seeking…'
    if (videoSeekingOverlayHint)
      videoSeekingOverlayHint.setAttribute('aria-hidden', 'true')
    clearTimeout(seekingLongTimer)
    seekingLongTimer = setTimeout(() => {
      seekingLongTimer = null
      if (videoSeekingOverlayText)
        videoSeekingOverlayText.textContent = 'Re-buffering…'
      if (videoSeekingOverlayHint)
        videoSeekingOverlayHint.removeAttribute('aria-hidden')
    }, 2500)
  }

  function onSeeked() {
    clearTimeout(seekingLongTimer)
    seekingLongTimer = null
    if (videoSeekingOverlay)
      videoSeekingOverlay.setAttribute('aria-hidden', 'true')
    if (videoSeekingOverlayHint)
      videoSeekingOverlayHint.setAttribute('aria-hidden', 'true')
  }

  function onCanPlay() {
    hasCanPlayed = true
    if (videoLoadingOverlay)
      videoLoadingOverlay.setAttribute('aria-hidden', 'true')
    if (videoBufferingOverlay)
      videoBufferingOverlay.setAttribute('aria-hidden', 'true')
  }

  function onWaiting() {
    if (!hasCanPlayed) return
    if (videoBufferingOverlay)
      videoBufferingOverlay.removeAttribute('aria-hidden')
  }

  function onPlaying() {
    if (videoBufferingOverlay)
      videoBufferingOverlay.setAttribute('aria-hidden', 'true')
  }

  function formatTime(secs) {
    return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(Math.floor(secs % 60)).padStart(2, '0')}`
  }

  function onProgress() {
    if (
      !videoLoadingOverlay ||
      videoLoadingOverlay.getAttribute('aria-hidden') === 'true'
    )
      return
    const b = video.buffered
    const bufferedEnd = b.length ? b.end(b.length - 1) : 0
    const dur = video.duration
    if (Number.isFinite(dur) && dur > 0) {
      const pct = Math.min(100, (bufferedEnd / dur) * 100)
      if (videoLoadingProgressFill)
        videoLoadingProgressFill.style.width = `${pct}%`
      if (videoLoadingProgressText)
        videoLoadingProgressText.textContent =
          pct >= 100
            ? 'Almost ready…'
            : `Buffered ${formatTime(bufferedEnd)} / ${formatTime(dur)} (${Math.round(pct)}%)`
    } else {
      if (videoLoadingProgressText)
        videoLoadingProgressText.textContent =
          bufferedEnd > 0
            ? `Loading metadata… (${formatTime(bufferedEnd)} received)`
            : 'Loading metadata…'
      if (videoLoadingProgressFill) videoLoadingProgressFill.style.width = '0%'
    }
  }

  // If video is already ready (e.g. cached), hide loading overlay immediately
  if (video.readyState >= 3) {
    hasCanPlayed = true
    if (videoLoadingOverlay)
      videoLoadingOverlay.setAttribute('aria-hidden', 'true')
  } else {
    onProgress()
  }

  // ── Per-frame callback: update sidebar stats + marker highlight ─────────────
  let activeMarkers = markers
  function onFrame(curFrame, curDepth) {
    if (curFrameEl) curFrameEl.textContent = curFrame
    if (curDepthEl) curDepthEl.textContent = curDepth.toFixed(3)

    let nearestIdx = -1,
      nearestDist = Infinity
    activeMarkers.forEach((m, i) => {
      const dist = Math.abs(m.frame - curFrame)
      if (dist < nearestDist) {
        nearestDist = dist
        nearestIdx = i
      }
    })
    if (nearestIdx !== lastHighlightedMarker) {
      const prev = markerListEl.querySelector('.marker-list-item.current')
      if (prev) prev.classList.remove('current')
      const next = document.getElementById(`mli-${nearestIdx}`)
      if (next) next.classList.add('current')
      lastHighlightedMarker = nearestIdx
    }
  }

  // ── Create shared engine ────────────────────────────────────────────────────
  const engine = createPlayerEngine({
    video,
    canvas,
    bxWrap,
    userSettings,
    offsetSecs: typeof meta.offset === 'number' ? meta.offset / 1000 : 0,
    onSeeking,
    onSeeked,
    onCanPlay,
    onWaiting,
    onPlaying,
    onProgress,
    onFrame,
  })

  engine.loadBxData(path, totalFrames, bxSources[0].effects || [])

  // ── Auto-detect real duration from the video element ───────────────────────
  function onVideoMetadataLoaded() {
    if (!Number.isFinite(video.duration) || video.duration <= 0) return
    const realFrames = Math.round(video.duration * FPS)
    totalFrames = realFrames

    bxSources.forEach((src) => {
      src._path = buildPath(src.data, realFrames)
    })

    const activeIdx = bxSelect ? parseInt(bxSelect.value) || 0 : 0
    engine.loadBxData(bxSources[activeIdx]._path || path, realFrames, bxSources[activeIdx].effects || [])

    const statDur = document.getElementById('statDuration')
    const statFr = document.getElementById('statFrames')
    if (statDur) statDur.textContent = framesToTimecode(realFrames)
    if (statFr) statFr.textContent = realFrames.toLocaleString()
  }

  video.addEventListener('loadedmetadata', onVideoMetadataLoaded)
  if (Number.isFinite(video.duration) && video.duration > 0) onVideoMetadataLoaded()
  function wireMarkerClicks() {
    markerListEl.querySelectorAll('.marker-list-item').forEach((item) => {
      item.addEventListener('click', () => {
        video.currentTime = parseInt(item.dataset.frame) / FPS
      })
    })
  }
  wireMarkerClicks()

  function rebuildMarkerList(newMarkers) {
    markerListEl.innerHTML = newMarkers
      .map(
        (m, i) => `
      <div class="marker-list-item" data-frame="${m.frame}" id="mli-${i}">
        <span class="marker-frame-num">${m.frame}</span>
        <div class="marker-depth-bar">
          <div class="marker-depth-fill" style="width:${(m.depth * 100).toFixed(1)}%"></div>
        </div>
        <span class="marker-depth-val">${m.depth.toFixed(2)}</span>
        <span class="marker-ease-tag">${easeLabel(m.trans, m.ease)}</span>
      </div>`,
      )
      .join('')
    wireMarkerClicks()
    document.getElementById('markerListTitle').textContent =
      `Markers (${newMarkers.length})`
    document.getElementById('sidebarMarkerCount').textContent =
      newMarkers.length
    document.getElementById('statsMarkerCount').textContent = newMarkers.length
    lastHighlightedMarker = -1
  }

  // ── BX file dropdown ────────────────────────────────────────────────────────
  const bxSelect = document.getElementById('bxSelect')
  if (bxSelect) {
    bxSelect.addEventListener('change', () => {
      const src = bxSources[parseInt(bxSelect.value)]
      const newMarkers = markersFromData(src.data)
      const newPath = src._path || buildPath(src.data, totalFrames)
      engine.loadBxData(newPath, totalFrames, src.effects || [])
      activeMarkers = newMarkers
      document.getElementById('sidebarBxFile').textContent = src.file
      rebuildMarkerList(newMarkers)
    })
  }
}

// ── Sidebar Tab Switching ────────────────────────────────────────────────────

function switchSidebarTab(tab) {
  const bxTab = document.getElementById('sidebarTabBx')
  const moreTab = document.getElementById('sidebarTabMore')
  const bxPanel = document.getElementById('sidebarPanelBx')
  const morePanel = document.getElementById('sidebarPanelMore')

  if (tab === 'bx') {
    bxTab.classList.add('active')
    moreTab.classList.remove('active')
    bxPanel.classList.add('active')
    morePanel.classList.remove('active')
  } else {
    moreTab.classList.add('active')
    bxTab.classList.remove('active')
    morePanel.classList.add('active')
    bxPanel.classList.remove('active')
  }
}

// ── More Videos ──────────────────────────────────────────────────────────────

async function loadMoreVideos(currentId, currentTags) {
  const container = document.getElementById('moreVideosList')
  if (!container) return

  // Wire tab buttons now that DOM exists
  const bxTabBtn = document.getElementById('sidebarTabBx')
  const moreTabBtn = document.getElementById('sidebarTabMore')
  if (bxTabBtn) bxTabBtn.addEventListener('click', () => switchSidebarTab('bx'))
  if (moreTabBtn)
    moreTabBtn.addEventListener('click', () => switchSidebarTab('more'))

  try {
    const manifest = await fetchJSON(`${VIDEO_BASE}/manifest.json`)
    const otherIds = manifest.filter((id) => id !== currentId)

    if (otherIds.length === 0) {
      container.innerHTML =
        '<div style="color:var(--text3);font-size:0.75rem;font-family:var(--mono);padding:0.5rem 0">No other videos found.</div>'
      return
    }

    const metas = await Promise.all(
      otherIds.map((id) => {
        const url = `${VIDEO_BASE}/${encodeURIComponent(id)}/meta.json`
        return fetch(url, { cache: 'no-store' })
          .then((res) => {
            if (res.status === 404) return { title: id, _folder: id }
            if (!res.ok) return null
            return res.json().then((m) => ({ ...m, _folder: id }))
          })
          .catch(() => null)
      }),
    )
    const valid = metas.filter(Boolean)

    const tagSet = new Set((currentTags || []).map((t) => t.toLowerCase()))
    const scored = valid.map((m) => {
      const overlap = (m.tags || []).filter((t) =>
        tagSet.has(t.toLowerCase()),
      ).length
      return { meta: m, score: overlap }
    })
    scored.sort((a, b) =>
      b.score !== a.score ? b.score - a.score : Math.random() - 0.5,
    )

    container.innerHTML = scored
      .slice(0, 5)
      .map(({ meta: m }) => {
        const folder = m._folder || m.videoId
        const thumbSrc = m.thumbnail
          ? `${VIDEO_BASE}/${encodeURIComponent(folder)}/${encodeURIComponent(m.thumbnail)}`
          : null
        const highlights = (m.highlightedTags || m.tags || []).slice(0, 2)
        const dur = m.duration ? framesToTimecode(m.duration) : ''

        return `
        <a class="more-video-card" href="watch.html?v=${encodeURIComponent(folder)}">
          ${
            thumbSrc
              ? `<img class="more-video-thumb" src="${thumbSrc}" alt="" loading="lazy" onerror="this.style.display='none';this.nextSibling.style.display='flex'">`
              : ''
          }
          <div class="more-video-thumb-placeholder"${thumbSrc ? ' style="display:none"' : ''}>▶</div>
          <div class="more-video-info">
            <div class="more-video-title">${escHtml(m.title || folder)}</div>
            <div class="more-video-author">${escHtml(m.pathCreator || '')}</div>
            <div class="more-video-tags">
              ${highlights.map((t) => `<span class="more-video-tag">${escHtml(t)}</span>`).join('')}
              ${dur ? `<span class="more-video-tag" style="background:rgba(255,255,255,0.05);color:var(--text3);border-color:var(--border)">${dur}</span>` : ''}
            </div>
          </div>
        </a>`
      })
      .join('')
  } catch (e) {
    container.innerHTML =
      '<div style="color:var(--text3);font-size:0.75rem;font-family:var(--mono);padding:0.5rem 0">Could not load suggestions.</div>'
    console.warn('loadMoreVideos:', e)
  }
}
