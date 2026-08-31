async function offscreenReport() {
  const url = chrome.runtime.getURL('offscreen.html')
  const existing = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })
  if (!existing.length) {
    await chrome.offscreen.createDocument({
      url,
      reasons: ['WORKERS', 'BLOBS'],
      justification: 'measure cross-origin isolation',
    })
  }
  return new Promise((res) => {
    const t = setTimeout(() => res('TIMEOUT'), 8000)
    chrome.runtime.onMessage.addListener(function h(m) {
      if (m && m.offscreenReport) {
        clearTimeout(t)
        chrome.runtime.onMessage.removeListener(h)
        res(m.offscreenReport)
      }
    })
    chrome.runtime.sendMessage({ askOffscreen: true }).catch(() => {})
  })
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.probe) return
  ;(async () => {
    const out = {
      swCrossOriginIsolated: self.crossOriginIsolated,
      swHasSAB: typeof SharedArrayBuffer !== 'undefined',
      hardwareConcurrency: navigator.hardwareConcurrency,
    }
    try {
      out.offscreen = await offscreenReport()
    } catch (e) {
      out.offscreen = 'THREW:' + e.message
    }
    sendResponse(out)
  })()
  return true
})
