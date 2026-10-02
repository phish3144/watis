import { install } from '../../bridge/index'
import { TO_HOST, type BridgeMessage } from '../../bridge/protocol'

/**
 * The bridge's way into the page in the browser extension (ADR 0010).
 *
 * On the desktop, the main process injects `bridge.js` after every `did-finish-load`. Here the
 * browser does the injecting, as a MAIN-world content script — measured to run despite WhatsApp's
 * nonce CSP (docs/extension-spike.md). The bridge code itself is the same file, unchanged.
 *
 * Two things differ, and both are handled here rather than in the bridge:
 *
 *  - **Timing.** Content scripts run at `document_start`, long before WhatsApp's loader has
 *    registered the modules the bridge resolves. Installing waits for the `load` event, which is
 *    what `did-finish-load` is on the desktop. (A dynamic import would not defer anything here:
 *    bundled into one classic script, the module's top level runs at once.)
 *  - **A second chance.** The desktop gets one healthcheck per page load. A tab that is still on
 *    the QR code, or whose chats are still loading, fails that check and would then never mirror
 *    anything until the next reload. So a failed check is retried with a growing pause, until it
 *    passes. Every retry is a read: it resolves modules and attaches listeners, nothing else.
 */

declare const window: {
  __watisBridge?: { stop: () => void }
  addEventListener(type: string, listener: () => void, options?: { once?: boolean }): void
  setTimeout(handler: () => void, ms: number): number
}
declare const document: {
  readyState: string
  addEventListener(type: string, listener: (event: { detail?: unknown }) => void): void
}

const RETRY_MS = [5_000, 10_000, 20_000, 40_000, 60_000]

function installBridge(): void {
  // The predecessor is stopped first, so a retry cannot double the listeners on WhatsApp's
  // collections.
  window.__watisBridge?.stop()
  window.__watisBridge = install()
}

function start(): void {
  let attempt = 0
  let healthy = false

  // Attached before the first install, so its report is heard.
  document.addEventListener(TO_HOST, (event) => {
    if (healthy || typeof event.detail !== 'string') return
    let message: BridgeMessage
    try {
      message = JSON.parse(event.detail) as BridgeMessage
    } catch {
      return
    }
    if (message.type !== 'ready') return
    if (message.ok) {
      healthy = true
      return
    }
    const wait = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 60_000
    attempt += 1
    window.setTimeout(() => {
      if (!healthy) installBridge()
    }, wait)
  })

  installBridge()
}

if (document.readyState === 'complete') start()
else window.addEventListener('load', start, { once: true })
