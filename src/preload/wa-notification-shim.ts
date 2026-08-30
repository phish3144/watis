/**
 * Injected into the page's MAIN world, as a string, from the preload's top level.
 *
 * Why the main world: WhatsApp captures `window.Notification` while its bundle evaluates, so the
 * replacement has to be in place before any page script runs. `webFrame.executeJavaScript` at
 * preload top level is guaranteed to run first. (`contextBridge.executeInMainWorld` would be the
 * tidier API but is still experimental in Electron 44.)
 *
 * Why not simply let Chromium render WhatsApp's notifications: then there is no way to coalesce
 * per chat, respect the user's DND schedule, suppress a toast for the chat already on screen, or
 * open the right chat on click. Chromium only routes a click to window focus.
 *
 * The failure mode is silence, not an error: if WhatsApp ever grabs `Notification` before this
 * runs, notifications simply stop. `notificationShimHealthy()` in the preload detects that.
 */
export const NOTIFICATION_SHIM = String.raw`
(() => {
  if (window.__watisNotificationShim) return
  const live = new Map()
  let seq = 0

  // Strings copy reliably across the isolated-world boundary; arbitrary objects depend on the
  // wrapper, so the payload always travels as JSON.
  const emit = (name, detail) =>
    document.dispatchEvent(new CustomEvent(name, { detail: JSON.stringify(detail) }))

  // WhatsApp passes icons as blob: URLs, which the main process cannot resolve. Convert here,
  // where the blob is readable.
  const toDataUrl = async (url) => {
    if (typeof url !== 'string' || !url.startsWith('blob:')) return typeof url === 'string' ? url : ''
    try {
      const blob = await (await fetch(url)).blob()
      if (blob.size > 512 * 1024) return ''
      return await new Promise((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => resolve('')
        reader.readAsDataURL(blob)
      })
    } catch { return '' }
  }

  class WatIsNotification extends EventTarget {
    static get permission() { return 'granted' }
    static get maxActions() { return 2 }
    static requestPermission(callback) {
      if (typeof callback === 'function') callback('granted')
      return Promise.resolve('granted')
    }
    constructor(title, options) {
      super()
      const opts = options || {}
      this.title = String(title)
      this.body = typeof opts.body === 'string' ? opts.body : ''
      this.tag = typeof opts.tag === 'string' ? opts.tag : ''
      this.data = opts.data
      this.onclick = null
      this.onclose = null
      this.onerror = null
      this.onshow = null
      this._id = 'n' + ++seq
      live.set(this._id, this)
      void toDataUrl(opts.icon).then((icon) =>
        emit('watis:notify', { id: this._id, title: this.title, body: this.body, tag: this.tag, icon }),
      )
    }
    close() {
      live.delete(this._id)
      emit('watis:notify-close', { id: this._id })
    }
  }

  document.addEventListener('watis:notify-event', (event) => {
    let payload
    try { payload = JSON.parse(event.detail) } catch { return }
    const target = live.get(payload.id)
    if (!target) return
    // Call WhatsApp's own handler. That is what opens the right chat — dispatching a DOM event
    // would only notify listeners that WhatsApp does not register.
    if (payload.type === 'click') {
      if (typeof target.onclick === 'function') target.onclick.call(target, new Event('click'))
      target.dispatchEvent(new Event('click'))
    } else if (payload.type === 'close') {
      live.delete(payload.id)
      if (typeof target.onclose === 'function') target.onclose.call(target, new Event('close'))
    }
  })

  Object.defineProperty(window, 'Notification', {
    value: WatIsNotification,
    configurable: true,
    writable: true,
  })
  window.__watisNotificationShim = true
})()
`

/**
 * Enter / Shift+Enter behaviour, also main-world: the handler has to sit on the same element
 * WhatsApp listens on and run before it, which a listener from the isolated world cannot
 * guarantee for composed key handling.
 */
export const ENTER_KEY_SHIM = String.raw`
(() => {
  if (window.__watisEnterShim) return
  window.__watisEnterKeyInsertsNewline = window.__watisEnterKeyInsertsNewline || false
  document.addEventListener(
    'keydown',
    (event) => {
      if (!window.__watisEnterKeyInsertsNewline) return
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return
      const box = event.target
      if (!box || !box.isContentEditable) return
      // Ctrl+Enter sends; a bare Enter becomes a newline.
      if (event.ctrlKey || event.metaKey) return
      event.stopImmediatePropagation()
      document.execCommand('insertLineBreak')
      event.preventDefault()
    },
    true,
  )
  window.__watisEnterShim = true
})()
`
