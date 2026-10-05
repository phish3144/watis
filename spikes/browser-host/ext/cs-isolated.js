// ISOLATED world: inject the extension-origin host frame and report what it says.
const api = globalThis.browser ?? globalThis.chrome
const root = document.documentElement
const frame = document.createElement('iframe')
frame.src = api.runtime.getURL('host.html')
frame.style.display = 'none'
root.setAttribute(
  'data-probe-check-url',
  api.runtime.getURL('host.html').replace('host.html', 'check.html'),
)
const extOrigin = new URL(frame.src).origin
window.addEventListener('message', (event) => {
  if (event.origin !== extOrigin) return
  root.setAttribute('data-probe-host', JSON.stringify(event.data))
  api.runtime.sendMessage({ type: 'check' }).then(
    (out) => root.setAttribute('data-probe-background', JSON.stringify(out)),
    (e) => root.setAttribute('data-probe-background', String(e)),
  )
})
frame.addEventListener('load', () => root.setAttribute('data-probe-frame', 'loaded'))
frame.addEventListener('error', () => root.setAttribute('data-probe-frame', 'error'))
;(document.body ?? root).appendChild(frame)
