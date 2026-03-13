/**
 * BounceX Viewer — Index / Browse
 *
 * Videos are discovered from a manifest at videos/manifest.json
 * Playlists are discovered from playlists/manifest.json
 */

const VIDEO_BASE = 'videos'
const PLAYLIST_BASE = 'playlists'

// ── State ──────────────────────────────────────────────────────────────────
let allVideos = []
let allPlaylists = []
let searchQuery = ''
let activeTab = 'videos'
// View mode: 'grid' | 'list' — persisted per-panel in sessionStorage
let videoViewMode = sessionStorage.getItem('bx_view_videos') || 'grid'
let playlistViewMode = sessionStorage.getItem('bx_view_playlists') || 'grid'

const VIDEO_TYPES = ['BounceX', 'Dildo Hero', 'Other']
const DIFFICULTIES = ['Easy', 'Medium', 'Hard', 'Extreme', 'Multi-Difficulty']
const SONG_QUANTITY = ['Single Song', 'Compilation', 'No Song']
const RESERVED_TAGS = new Set(
  [...VIDEO_TYPES, ...DIFFICULTIES, ...SONG_QUANTITY].map((t) =>
    t.toLowerCase(),
  ),
)

const activeFilters = {
  videoType: new Set(),
  difficulty: new Set(),
  songQuantity: new Set(),
  pathCreator: new Set(),
  videoCreator: new Set(),
  tags: new Set(),
}

// ── View Toggle Logic ──────────────────────────────────────────────────────
function initViewToggles() {
  function applyViewMode(gridEl, mode, btnGrid, btnList) {
    if (!gridEl) return
    gridEl.classList.toggle('list-view', mode === 'list')
    btnGrid.classList.toggle('active', mode === 'grid')
    btnList.classList.toggle('active', mode === 'list')
    btnGrid.setAttribute('aria-pressed', String(mode === 'grid'))
    btnList.setAttribute('aria-pressed', String(mode === 'list'))
  }

  const videoGrid = document.getElementById('videoGrid')
  const playlistGrid = document.getElementById('playlistGrid')
  const btnGV = document.getElementById('btnGridViewVideos')
  const btnLV = document.getElementById('btnListViewVideos')
  const btnGP = document.getElementById('btnGridViewPlaylists')
  const btnLP = document.getElementById('btnListViewPlaylists')

  // Apply persisted modes immediately
  applyViewMode(videoGrid, videoViewMode, btnGV, btnLV)
  applyViewMode(playlistGrid, playlistViewMode, btnGP, btnLP)

  btnGV.addEventListener('click', () => {
    videoViewMode = 'grid'
    sessionStorage.setItem('bx_view_videos', 'grid')
    applyViewMode(videoGrid, 'grid', btnGV, btnLV)
  })
  btnLV.addEventListener('click', () => {
    videoViewMode = 'list'
    sessionStorage.setItem('bx_view_videos', 'list')
    applyViewMode(videoGrid, 'list', btnGV, btnLV)
  })
  btnGP.addEventListener('click', () => {
    playlistViewMode = 'grid'
    sessionStorage.setItem('bx_view_playlists', 'grid')
    applyViewMode(playlistGrid, 'grid', btnGP, btnLP)
  })
  btnLP.addEventListener('click', () => {
    playlistViewMode = 'list'
    sessionStorage.setItem('bx_view_playlists', 'list')
    applyViewMode(playlistGrid, 'list', btnGP, btnLP)
  })
}

// ── Boot ───────────────────────────────────────────────────────────────────
async function init() {
  try {
    const manifest = await fetchJSON(`${VIDEO_BASE}/manifest.json`)
    const metas = await Promise.all(
      manifest.map((id) =>
        fetchVideoMeta(id).then((m) => ({ ...m, _folder: id })),
      ),
    )
    allVideos = metas
    buildFilterBar()
    renderGrid()
    initViewToggles()
  } catch (e) {
    document.getElementById('videoGrid').innerHTML =
      `<div class="error-msg">Could not load manifest.<br><small>${e.message}</small></div>`
  }

  loadPlaylists()
}

async function loadPlaylists() {
  const grid = document.getElementById('playlistGrid')
  const count = document.getElementById('playlistCount')
  try {
    const manifest = await fetchJSON(`${PLAYLIST_BASE}/manifest.json`)
    const playlists = await Promise.all(
      manifest.map((id) =>
        fetchJSON(`${PLAYLIST_BASE}/${encodeURIComponent(id)}/meta.json`).then(
          (p) => ({
            ...p,
            _id: id,
          }),
        ),
      ),
    )
    allPlaylists = playlists
    count.textContent = `${playlists.length} playlist${playlists.length !== 1 ? 's' : ''}`
    renderPlaylists()
  } catch (e) {
    grid.innerHTML = `<div class="empty-state">No playlists found.</div>`
    count.textContent = '0 playlists'
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

/**
 * Fetch a video's meta.json, returning a synthesised fallback if it is absent
 * (404) so that meta.json is not required for every video folder.
 */
async function fetchVideoMeta(folder) {
  const url = `${VIDEO_BASE}/${encodeURIComponent(folder)}/meta.json`
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (res.status === 404) return _defaultMeta(folder)
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return res.json()
  } catch (e) {
    // Network error or parse failure — return safe default rather than
    // crashing the entire browse page.
    return _defaultMeta(folder)
  }
}

function _defaultMeta(folder) {
  return {
    title: folder,
    videoFile: `${folder}.mp4`,
    bxFiles: [{ label: 'Default', file: `${folder}.bx` }],
    // duration intentionally omitted — will be detected from the video element
  }
}

function framesToTimecode(frames, fps = 60) {
  const secs = Math.floor(frames / fps)
  const mm = String(Math.floor(secs / 60)).padStart(2, '0')
  const ss = String(secs % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

// ── Tab Switching ──────────────────────────────────────────────────────────
function setTab(tab) {
  activeTab = tab
  document.getElementById('panelVideos').style.display =
    tab === 'videos' ? '' : 'none'
  document.getElementById('panelPlaylists').style.display =
    tab === 'playlists' ? '' : 'none'
  document
    .getElementById('tabVideos')
    .classList.toggle('active', tab === 'videos')
  document
    .getElementById('tabPlaylists')
    .classList.toggle('active', tab === 'playlists')
}

// ── Filter Bar ─────────────────────────────────────────────────────────────
function buildFilterBar() {
  const pathCreators = [
    ...new Set(allVideos.map((v) => v.pathCreator).filter(Boolean)),
  ].sort()
  const videoCreators = [
    ...new Set(allVideos.map((v) => v.videoCreator).filter(Boolean)),
  ].sort()

  const tagCounts = {}
  allVideos.forEach((v) => {
    ;(v.tags || []).forEach((t) => {
      if (!RESERVED_TAGS.has(t.toLowerCase())) {
        tagCounts[t] = (tagCounts[t] || 0) + 1
      }
    })
  })
  const generalTags = Object.keys(tagCounts).sort()

  const container = document.getElementById('tagFilter')
  container.innerHTML = ''
  container.className = 'filter-bar'

  const groups = [
    { key: 'videoType', label: 'Video Type', items: VIDEO_TYPES },
    { key: 'difficulty', label: 'Difficulty', items: DIFFICULTIES },
    { key: 'songQuantity', label: 'Song Quantity', items: SONG_QUANTITY },
    { key: 'pathCreator', label: 'Path Creator', items: pathCreators },
    { key: 'videoCreator', label: 'Video Creator', items: videoCreators },
    { key: 'tags', label: 'Tags', items: generalTags, searchable: true },
  ]

  groups.forEach(({ key, label, items, searchable }) => {
    const wrap = document.createElement('div')
    wrap.className = 'filter-dropdown-wrap'

    const btn = document.createElement('button')
    btn.className = 'filter-btn'
    btn.id = `filter-btn-${key}`
    btn.innerHTML =
      `${label}<span class="filter-badge" id="filter-badge-${key}"></span>` +
      `<svg class="filter-chevron" viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="1,1 5,5 9,1"/></svg>`

    const panel = document.createElement('div')
    panel.className = 'filter-panel'
    panel.id = `filter-panel-${key}`

    const header = document.createElement('div')
    header.className = 'filter-panel-header'
    header.innerHTML = `<span class="filter-panel-title">${label}</span><button class="filter-panel-reset" data-key="${key}">Reset</button>`
    panel.appendChild(header)

    if (searchable) {
      const search = document.createElement('input')
      search.type = 'text'
      search.className = 'filter-panel-search'
      search.placeholder = 'Search tags…'
      search.addEventListener('input', () => {
        const q = search.value.trim().toLowerCase()
        panel.querySelectorAll('.filter-check-item').forEach((el) => {
          el.style.display = el.dataset.value.toLowerCase().includes(q)
            ? ''
            : 'none'
        })
      })
      panel.appendChild(search)
    }

    const list = document.createElement('div')
    list.className = 'filter-check-list'

    items.forEach((item) => {
      const row = document.createElement('label')
      row.className = 'filter-check-item'
      row.dataset.value = item
      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.value = item
      cb.addEventListener('change', () => {
        if (cb.checked) activeFilters[key].add(item)
        else activeFilters[key].delete(item)
        updateFilterBadge(key)
        renderGrid()
      })
      row.appendChild(cb)
      row.appendChild(document.createTextNode(item))
      list.appendChild(row)
    })

    panel.appendChild(list)
    wrap.appendChild(btn)
    wrap.appendChild(panel)
    container.appendChild(wrap)

    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const isOpen = panel.classList.contains('open')
      closeAllPanels()
      if (!isOpen) {
        panel.classList.add('open')
        btn.classList.add('open')
      }
    })

    header
      .querySelector('.filter-panel-reset')
      .addEventListener('click', () => {
        activeFilters[key].clear()
        panel
          .querySelectorAll('input[type=checkbox]')
          .forEach((cb) => (cb.checked = false))
        updateFilterBadge(key)
        renderGrid()
      })
  })

  const resetAll = document.createElement('button')
  resetAll.className = 'filter-reset-all'
  resetAll.textContent = 'Reset All'
  resetAll.addEventListener('click', () => {
    Object.keys(activeFilters).forEach((k) => activeFilters[k].clear())
    container
      .querySelectorAll('input[type=checkbox]')
      .forEach((cb) => (cb.checked = false))
    Object.keys(activeFilters).forEach((k) => updateFilterBadge(k))
    renderGrid()
  })
  container.appendChild(resetAll)

  document.addEventListener('click', closeAllPanels)
  container.addEventListener('click', (e) => e.stopPropagation())
}

function closeAllPanels() {
  document
    .querySelectorAll('.filter-panel.open')
    .forEach((p) => p.classList.remove('open'))
  document
    .querySelectorAll('.filter-btn.open')
    .forEach((b) => b.classList.remove('open'))
}

function updateFilterBadge(key) {
  const badge = document.getElementById(`filter-badge-${key}`)
  const btn = document.getElementById(`filter-btn-${key}`)
  if (!badge) return
  const count = activeFilters[key].size
  badge.textContent = count > 0 ? count : ''
  badge.classList.toggle('visible', count > 0)
  btn?.classList.toggle('has-active', count > 0)
}

// ── Search ─────────────────────────────────────────────────────────────────
document.getElementById('searchInput').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim().toLowerCase()
  renderGrid()
})

const urlParams = new URLSearchParams(window.location.search)
if (urlParams.has('q')) {
  document.getElementById('searchInput').value = urlParams.get('q')
  searchQuery = urlParams.get('q').toLowerCase()
}

// ── Grid Render ────────────────────────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('videoGrid')
  const count = document.getElementById('videoCount')
  let filtered = allVideos

  const {
    videoType,
    difficulty,
    songQuantity,
    pathCreator,
    videoCreator,
    tags,
  } = activeFilters
  if (videoType.size > 0)
    filtered = filtered.filter((v) =>
      (v.tags || []).some((t) => videoType.has(t)),
    )
  if (difficulty.size > 0)
    filtered = filtered.filter((v) =>
      (v.tags || []).some((t) => difficulty.has(t)),
    )

  if (songQuantity.size > 0)
    filtered = filtered.filter((v) =>
      (v.tags || []).some((t) => songQuantity.has(t)),
    )

  if (pathCreator.size > 0)
    filtered = filtered.filter((v) => pathCreator.has(v.pathCreator))
  if (videoCreator.size > 0)
    filtered = filtered.filter((v) => videoCreator.has(v.videoCreator))
  if (tags.size > 0)
    filtered = filtered.filter((v) => (v.tags || []).some((t) => tags.has(t)))

  if (searchQuery) {
    filtered = filtered.filter((v) => {
      const haystack = [
        v.title || '',
        v.pathCreator || '',
        v.videoCreator || '',
        v.description || '',
        ...(v.tags || []),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(searchQuery)
    })
  }

  count.textContent = `${filtered.length} video${filtered.length !== 1 ? 's' : ''}`

  if (filtered.length === 0) {
    grid.innerHTML =
      '<div class="empty-state">No videos match your search.</div>'
    return
  }

  grid.innerHTML = ''
  // Re-apply view mode class after clearing innerHTML
  if (videoViewMode === 'list') grid.classList.add('list-view')
  filtered.forEach((v, i) => {
    const card = buildCard(v)
    card.style.animationDelay = `${i * 0.04}s`
    grid.appendChild(card)
    card.querySelectorAll('img[data-fallback]').forEach((img) => {
      img.addEventListener('error', () => {
        img.parentElement.innerHTML = thumbPlaceholder()
      })
    })
  })
}

function secsToTimecode(secs) {
  const s = Math.floor(secs)
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function secsToRuntime(secs) {
  const s = Math.floor(secs)
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  if (hh > 0) {
    return `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  }
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

function buildCard(v) {
  const folder = v._folder || v.videoId
  const thumbSrc = v.thumbnail
    ? `${VIDEO_BASE}/${encodeURIComponent(folder)}/${encodeURIComponent(v.thumbnail)}`
    : null
  // Prefer durationSecs (stored at create time) → legacy duration in frames → probe
  const timecode = v.durationSecs != null
    ? secsToTimecode(v.durationSecs)
    : v.duration
      ? framesToTimecode(v.duration)
      : null
  const highlights = (v.highlightedTags || []).slice(0, 3)

  const card = document.createElement('a')
  card.className = 'video-card'
  card.href = `watch.html?v=${encodeURIComponent(folder)}`

  const thumbDiv = document.createElement('div')
  thumbDiv.className = 'card-thumb'

  if (thumbSrc) {
    const img = document.createElement('img')
    img.src = thumbSrc
    img.alt = v.title || ''
    img.loading = 'lazy'
    img.addEventListener('error', () => {
      thumbDiv.innerHTML = thumbPlaceholder()
    })
    thumbDiv.appendChild(img)
  } else {
    thumbDiv.innerHTML = thumbPlaceholder()
  }

  card.appendChild(thumbDiv)

  card.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card-body">
      <div class="card-highlight-tags">
        ${highlights.map((t) => `<span class="card-tag">${escHtml(t)}</span>`).join('')}
      </div>
      <div class="card-title">${escHtml(v.title || folder)}</div>
      <div class="card-authors"><span><span class="card-author-label">Video by:</span>${escHtml(v.videoCreator || 'Unknown')}</span><span><span class="card-author-label">Path by:</span>${escHtml(v.pathCreator || 'Unknown')}</span></div>
      <div class="card-meta">
        <div class="card-meta-item">
          <span>BPM</span>
          <span>${v.bpm || '\u2014'}</span>
        </div>
        <div class="card-meta-item">
          <span>Duration</span>
          <span class="card-duration-meta">${timecode || '\u2014'}</span>
        </div>
      </div>
    </div>
  `,
  )

  // If duration wasn't in meta.json, probe the video file for it
  if (!timecode) {
    const videoFile = v.videoFile || `${folder}.mp4`
    const videoSrc = `${VIDEO_BASE}/${encodeURIComponent(folder)}/${encodeURIComponent(videoFile)}`
    const probe = document.createElement('video')
    probe.preload = 'metadata'
    probe.muted = true
    probe.style.display = 'none'
    probe.addEventListener('loadedmetadata', () => {
      if (probe.duration && isFinite(probe.duration)) {
        const tc = secsToTimecode(probe.duration)
        const metaSpan = card.querySelector('.card-duration-meta')
        if (metaSpan) metaSpan.textContent = tc
      }
      probe.src = ''
      probe.remove()
    }, { once: true })
    probe.addEventListener('error', () => {
      probe.src = ''
      probe.remove()
    }, { once: true })
    probe.src = videoSrc
  }

  return card
}

// ── Playlist Render ────────────────────────────────────────────────────────
function renderPlaylists() {
  const grid = document.getElementById('playlistGrid')

  if (allPlaylists.length === 0) {
    grid.innerHTML = '<div class="empty-state">No playlists yet.</div>'
    return
  }

  grid.innerHTML = ''
  if (playlistViewMode === 'list') grid.classList.add('list-view')
  allPlaylists.forEach((p, i) => {
    const card = buildPlaylistCard(p)
    card.style.animationDelay = `${i * 0.04}s`
    grid.appendChild(card)
  })
}

function buildPlaylistCard(p) {
  const videoCount = (p.videos || []).length

  // Try to get thumbnail from first video
  const firstVideoId =
    p.videos && p.videos[0]
      ? typeof p.videos[0] === 'string'
        ? p.videos[0]
        : p.videos[0].id || p.videos[0].videoId
      : null
  const thumbSrc = p.thumbnail
    ? `${PLAYLIST_BASE}/${encodeURIComponent(p._id)}/${encodeURIComponent(p.thumbnail)}`
    : firstVideoId
      ? `${VIDEO_BASE}/${encodeURIComponent(firstVideoId)}/thumb.jpg`
      : null

  const card = document.createElement('a')
  card.className = 'video-card'
  card.href = `playlist.html?p=${encodeURIComponent(p._id)}`

  const thumbDiv = document.createElement('div')
  thumbDiv.className = 'card-thumb'

  if (thumbSrc) {
    const img = document.createElement('img')
    img.src = thumbSrc
    img.alt = p.title || ''
    img.loading = 'lazy'
    img.addEventListener('error', () => {
      thumbDiv.innerHTML = playlistPlaceholder()
    })
    thumbDiv.appendChild(img)
  } else {
    thumbDiv.innerHTML = playlistPlaceholder()
  }

  // Playlist badge
  const badge = document.createElement('div')
  badge.className = 'card-duration'
  badge.textContent = `${videoCount} video${videoCount !== 1 ? 's' : ''}`
  thumbDiv.appendChild(badge)

  card.appendChild(thumbDiv)

  const highlights = (p.tags || []).slice(0, 3)

  card.insertAdjacentHTML(
    'beforeend',
    `
    <div class="card-body">
      <div class="card-highlight-tags">
        ${highlights.map((t) => `<span class="card-tag">${escHtml(t)}</span>`).join('')}
      </div>
      <div class="card-title">${escHtml(p.title || p._id)}</div>
      <div class="card-authors"><span><span class="card-author-label">Playlist by:</span>${escHtml(p.author || 'Unknown')}</span></div>
      <div class="card-meta">
        <div class="card-meta-item">
          <span>Videos</span>
          <span>${videoCount}</span>
        </div>
        ${p.totalDurationSecs != null ? `
        <div class="card-meta-item">
          <span>Runtime</span>
          <span>${secsToRuntime(p.totalDurationSecs)}</span>
        </div>` : ''}
      </div>
    </div>
  `,
  )

  return card
}

function thumbPlaceholder() {
  return `<div class="card-thumb-placeholder">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <polygon points="5,3 19,12 5,21"/>
    </svg>
  </div>`
}

function playlistPlaceholder() {
  return `<div class="card-thumb-placeholder">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <line x1="3" y1="6" x2="21" y2="6"/>
      <line x1="3" y1="12" x2="21" y2="12"/>
      <line x1="3" y1="18" x2="21" y2="18"/>
      <polygon points="10,9 10,15 15,12"/>
    </svg>
  </div>`
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

document
  .getElementById('tabVideos')
  .addEventListener('click', () => setTab('videos'))
document
  .getElementById('tabPlaylists')
  .addEventListener('click', () => setTab('playlists'))

init()

// ── Live reload from Manager ───────────────────────────────────────────────────
;(async function startManagerSync() {
  const cfg = window._bxConfigP ? await window._bxConfigP : null
  if (!cfg) return // Can't reach config, skip manager sync
  const MANAGER_API = 'http://' + location.hostname + ':' + cfg.managerPort + '/manager-api/version'
  let lastVersion = null

  async function poll() {
    try {
      const res = await fetch(MANAGER_API, { cache: 'no-store' })
      if (!res.ok) return
      const { version } = await res.json()
      if (lastVersion === null) {
        lastVersion = version
        return
      }
      if (version !== lastVersion) {
        lastVersion = version
        const manifest = await fetchJSON(`${VIDEO_BASE}/manifest.json`)
        const metas = await Promise.all(
          manifest.map((id) =>
            fetchVideoMeta(id).then((m) => ({ ...m, _folder: id })),
          ),
        )
        allVideos = metas
        buildFilterBar()
        renderGrid()
        await loadPlaylists()
      }
    } catch {
      /* manager not running */
    }
  }

  setInterval(poll, 2000)
})()
