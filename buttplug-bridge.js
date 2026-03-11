/**
 * buttplug-bridge.js — BounceX Viewer ↔ Intiface Central bridge
 *
 * Depends on buttplug.js being loaded first (local file, not CDN).
 * Exposes window.BpBridge for use by player.js.
 *
 * Architecture:
 *   ButtplugClient (browser) ──WebSocket──► Intiface Central ──BLE/USB──► Device
 *
 * Usage:
 *   BpBridge.connect(wsUrl)          // e.g. "ws://localhost:12345"
 *   BpBridge.disconnect()
 *   BpBridge.sendDepth(depth, videoEl) // depth 0.0–1.0, videoEl for timing
 *   BpBridge.onStatusChange = fn     // called when state changes
 */

;(function () {
  'use strict'

  // ── Constants ──────────────────────────────────────────────────────────────
  const FPS = 60
  const SEND_INTERVAL_MS = 50 // send commands at ~20Hz
  const LINEAR_LOOKAHEAD_MS = 100 // how far ahead to look for stroker targets

  // ── State ──────────────────────────────────────────────────────────────────
  let client = null
  let devices = []
  let isConnected = false
  let lastSendTime = 0
  let lastDepth = -1
  let activePath = null // reference set by player when bx data loads
  let totalFrames = 14400

  // ── Public API ─────────────────────────────────────────────────────────────
  const BpBridge = {
    onStatusChange: null, // (status: 'connecting'|'connected'|'disconnected'|'error', msg) => void
    onDevicesChange: null, // (devices: Device[]) => void

    /** Connect to Intiface Central at the given WebSocket URL */
    async connect(wsUrl) {
      if (isConnected) await this.disconnect()

      _emit('connecting', `Connecting to ${wsUrl}…`)

      // Library exports to window.buttplug (lowercase) in v3
      const bp = window.buttplug
      if (!bp || !bp.ButtplugClient) {
        _emit(
          'error',
          'buttplug.js not loaded. Place buttplug.js in your project folder.',
        )
        return
      }

      try {
        client = new bp.ButtplugClient('BounceX Viewer')

        client.addListener('deviceadded', (device) => {
          devices = client.devices
          _emitDevices()
        })

        client.addListener('deviceremoved', (device) => {
          devices = client.devices
          _emitDevices()
        })

        client.addListener('disconnect', () => {
          isConnected = false
          devices = []
          _emit('disconnected', 'Intiface disconnected.')
          _emitDevices()
        })

        const connector = new bp.ButtplugBrowserWebsocketClientConnector(wsUrl)
        await client.connect(connector)

        isConnected = true
        devices = client.devices
        _emit('connected', `Connected to ${wsUrl}`)
        _emitDevices()
      } catch (e) {
        isConnected = false
        client = null
        _emit('error', `Connection failed: ${e.message}`)
      }
    },

    /** Disconnect from Intiface */
    async disconnect() {
      if (client) {
        try {
          await client.disconnect()
        } catch {}
        client = null
      }
      isConnected = false
      devices = []
      _emit('disconnected', 'Disconnected.')
      _emitDevices()
    },

    /** Called by player every animation frame with current depth (0–1) and the video element */
    sendDepth(depth, videoEl, pathRef, totalFramesRef) {
      if (!isConnected || devices.length === 0) return

      const now = performance.now()
      if (now - lastSendTime < SEND_INTERVAL_MS) return
      lastSendTime = now

      // Store path reference for look-ahead
      if (pathRef !== undefined) activePath = pathRef
      if (totalFramesRef !== undefined) totalFrames = totalFramesRef

      devices.forEach((device) => {
        try {
          _sendToDevice(device, depth, videoEl)
        } catch {}
      })
    },

    /** Let the player register its path array for look-ahead timing */
    setPath(path, frames) {
      activePath = path
      totalFrames = frames || 14400
    },

    get connected() {
      return isConnected
    },
    get deviceList() {
      return devices.slice()
    },

    /** Start Intiface scanning for new devices */
    async startScanning() {
      if (!isConnected || !client) return
      try {
        await client.startScanning()
      } catch {}
    },

    /** Stop scanning */
    async stopScanning() {
      if (!isConnected || !client) return
      try {
        await client.stopScanning()
      } catch {}
    },
  }

  // ── Internal helpers ───────────────────────────────────────────────────────

  function _emit(status, msg) {
    if (BpBridge.onStatusChange) BpBridge.onStatusChange(status, msg)
  }

  function _emitDevices() {
    if (BpBridge.onDevicesChange) BpBridge.onDevicesChange(BpBridge.deviceList)
  }

  /**
   * Send the right command to a device based on its capabilities:
   *  - Linear actuators (strokers):  device.linear(position, durationMs)
   *  - Vibrators:                    device.vibrate(intensity)
   *  - Rotators:                     device.rotate(speed, clockwise)
   */
  function _sendToDevice(device, depth, videoEl) {
    const msgs = device.messageAttributes

    // ── Linear (strokers: The Handy, OSR-2, Kiiroo etc.) ──────────────────
    if (msgs.LinearCmd) {
      // Look ahead: find where the path will be in LOOKAHEAD ms
      // This gives Intiface enough time to move the device to the right spot.
      let targetDepth = depth
      let durationMs = LINEAR_LOOKAHEAD_MS

      if (activePath && videoEl && !videoEl.paused) {
        const lookaheadSecs = LINEAR_LOOKAHEAD_MS / 1000
        const futureFrame = Math.min(
          Math.round((videoEl.currentTime + lookaheadSecs) * FPS),
          totalFrames - 1,
        )
        const futureDepth = activePath[futureFrame]
        if (futureDepth >= 0) {
          targetDepth = futureDepth
        }
      }

      device.linear(targetDepth, durationMs)
      return
    }

    // ── Vibrators ──────────────────────────────────────────────────────────
    if (msgs.VibrateCmd) {
      // Map depth to vibration intensity: deeper = stronger
      device.vibrate(depth)
      return
    }

    // ── Rotators ──────────────────────────────────────────────────────────
    if (msgs.RotateCmd) {
      device.rotate(depth, true)
    }
  }

  // Expose globally
  window.BpBridge = BpBridge
})()
