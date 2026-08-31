/**
 * Main-world shims for the media experience (PLAN.md Phase 1).
 *
 * Both run inside WhatsApp's page because both need objects the isolated world cannot reach: the
 * `<video>`/`<audio>` elements WhatsApp creates, and the image element inside its viewer. Neither
 * touches WhatsApp's own code — they attach listeners and set properties on DOM nodes, which is the
 * same thing a browser extension's content script does and nothing like calling into the store.
 */

/**
 * Routes playback to a chosen output device.
 *
 * `setSinkId` has to be called on each element, and WhatsApp creates them as messages are played,
 * so a MutationObserver applies it to new ones. Elements that reject the id — a device that was
 * unplugged since it was chosen — fall back to the default rather than staying silent.
 */
export const AUDIO_SINK_SHIM = String.raw`
(() => {
  if (window.__watisAudioSink) return
  window.__watisAudioSink = true
  window.__watisSinkId = window.__watisSinkId || ''

  const apply = (element) => {
    if (typeof element.setSinkId !== 'function') return
    if (element.__watisSink === window.__watisSinkId) return
    element.__watisSink = window.__watisSinkId
    element.setSinkId(window.__watisSinkId).catch(() => {
      // The device is gone. Falling back beats playing to nowhere.
      element.__watisSink = ''
      element.setSinkId('').catch(() => {})
    })
  }

  const applyAll = () => {
    for (const element of document.querySelectorAll('video, audio')) apply(element)
  }

  window.__watisApplySink = (id) => {
    window.__watisSinkId = id || ''
    applyAll()
  }

  new MutationObserver(applyAll).observe(document.documentElement, {
    childList: true,
    subtree: true,
  })
  applyAll()
})()
`

/**
 * Zoom and pan in WhatsApp's image viewer, which has neither.
 *
 * Scoped to the element the viewer is showing and torn down when it disappears, so nothing here
 * survives the viewer being closed. Ctrl is not required for the wheel: inside a full-screen image
 * viewer there is nothing else a wheel could sensibly mean.
 */
export const MEDIA_VIEWER_SHIM = String.raw`
(() => {
  if (window.__watisViewerZoom) return
  window.__watisViewerZoom = true

  let scale = 1
  let x = 0
  let y = 0
  let target = null

  const paint = () => {
    if (!target) return
    target.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')'
    target.style.transformOrigin = 'center center'
    target.style.cursor = scale > 1 ? 'grab' : ''
  }

  const reset = () => {
    scale = 1
    x = 0
    y = 0
    if (target) target.style.transform = ''
  }

  // The viewer is whatever full-screen dialog currently holds an image. Matching on the role
  // rather than a class name: WhatsApp's classes are generated and change between builds.
  const findImage = () => {
    const dialog = document.querySelector('[data-animate-modal-body="true"], [role="dialog"]')
    return dialog ? dialog.querySelector('img[src]') : null
  }

  const track = () => {
    const found = findImage()
    if (found === target) return
    if (target) reset()
    target = found
    if (target) {
      scale = 1
      x = 0
      y = 0
    }
  }

  new MutationObserver(track).observe(document.documentElement, { childList: true, subtree: true })
  track()

  document.addEventListener(
    'wheel',
    (event) => {
      if (!target || !target.isConnected) return
      event.preventDefault()
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
      scale = Math.min(8, Math.max(1, scale * factor))
      if (scale === 1) {
        x = 0
        y = 0
      }
      paint()
    },
    { passive: false, capture: true },
  )

  let dragging = false
  let lastX = 0
  let lastY = 0

  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!target || scale <= 1) return
      dragging = true
      lastX = event.clientX
      lastY = event.clientY
    },
    true,
  )
  document.addEventListener('pointerup', () => {
    dragging = false
  }, true)
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!dragging || !target) return
      x += event.clientX - lastX
      y += event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY
      paint()
    },
    true,
  )

  document.addEventListener(
    'keydown',
    (event) => {
      if (!target || !target.isConnected) return
      if (event.key === '+' || event.key === '=') scale = Math.min(8, scale * 1.25)
      else if (event.key === '-') scale = Math.max(1, scale / 1.25)
      else if (event.key === '0') {
        reset()
        return
      } else return
      event.preventDefault()
      if (scale === 1) {
        x = 0
        y = 0
      }
      paint()
    },
    true,
  )
})()
`
