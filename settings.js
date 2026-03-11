/**
 * BounceX Viewer – User Settings
 * Persisted in localStorage; used by player, playlist, and (future) Service Worker cache.
 */

const BX_SETTINGS_KEY = 'bx_viewer_settings'

const DEFAULTS = {
  pathColor: '#f0b429',
  ballColor: '#ffffff',
  topLineInactive: '#ffffff',
  topLineActive: '#3dd6c8',
  bottomLineInactive: '#ffffff',
  bottomLineActive: '#f07849',
  defaultOverlay: false,
  defaultOverlayBg: false,
  defaultFlipY: false,
  defaultZoom: 0.25,
  intifaceEnabled: false,
  intifaceUrl: 'ws://localhost:12345',
}

function getSettings() {
  try {
    const raw = localStorage.getItem(BX_SETTINGS_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

function setSettings(partial) {
  const current = getSettings()
  const next = { ...current, ...partial }
  localStorage.setItem(BX_SETTINGS_KEY, JSON.stringify(next))
  return next
}

function resetSettings() {
  localStorage.removeItem(BX_SETTINGS_KEY)
  return { ...DEFAULTS }
}
