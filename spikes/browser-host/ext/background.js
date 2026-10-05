// Top-level extension context in both browsers (Chromium: service worker, Firefox: event page).
const api = globalThis.browser ?? globalThis.chrome
api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'check') return
  ;(async () => {
    const out = {}
    try {
      const dir = await navigator.storage.getDirectory()
      out.marker = await (await (await dir.getFileHandle('marker.txt')).getFile()).text()
    } catch (e) {
      out.markerError = String(e)
    }
    try {
      out.heldLocks = (await navigator.locks.query()).held.map((l) => l.name)
    } catch (e) {
      out.lockError = String(e)
    }
    sendResponse(out)
  })()
  return true
})
