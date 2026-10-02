import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { ENTER_KEY_SHIM, NOTIFICATION_SHIM } from './wa-notification-shim'
import { AUDIO_SINK_SHIM, MEDIA_VIEWER_SHIM } from './wa-media-shim'
import { activeChatTitle, readUnreadFromIndexedDb, readUnreadFromTitle } from './page-reading'

/**
 * Preload for the WhatsApp view. Runs in the isolated world, sandboxed, CommonJS.
 *
 * It does four things and nothing else:
 *  1. installs the main-world shims (notifications, Enter key) before any page script runs,
 *  2. reads the unread count out of WhatsApp's own IndexedDB,
 *  3. relays between the page and the main process,
 *  4. carries the bridge's messages across the world boundary, without reading them.
 *
 * It never writes to WhatsApp. The read-only bridge into WhatsApp's internal stores lives in the
 * page world, in `src/bridge/`; this file relays for it and will not grow into it.
 */

// Main-world injection. Must happen at top level: WhatsApp captures window.Notification while
// its bundle evaluates, so anything later is too late.
void webFrame.executeJavaScript(NOTIFICATION_SHIM)
void webFrame.executeJavaScript(ENTER_KEY_SHIM)
// These two do not race WhatsApp's bundle the way the notification shim does — they observe the
// DOM rather than replacing a global — but there is no reason to run them later either.
void webFrame.executeJavaScript(AUDIO_SINK_SHIM)
void webFrame.executeJavaScript(MEDIA_VIEWER_SHIM)

// --- page -> main -----------------------------------------------------------

document.addEventListener('watis:notify', (event) => {
  const detail = (event as CustomEvent<string>).detail
  try {
    ipcRenderer.send('wa:notification', JSON.parse(detail))
  } catch {
    /* malformed payload from the page: drop it */
  }
})

document.addEventListener('watis:notify-close', (event) => {
  const detail = (event as CustomEvent<string>).detail
  try {
    ipcRenderer.send('wa:notification-close', JSON.parse(detail))
  } catch {
    /* drop */
  }
})

// --- bridge relay -----------------------------------------------------------
//
// The bridge itself runs in the page world, where `window.require` lives and `ipcRenderer` must
// never go. Both worlds share the document, so a CustomEvent is the whole channel. This preload
// forwards in both directions and reads neither payload — it is a wire, not a participant.

document.addEventListener('watis:bridge-out', (event) => {
  ipcRenderer.send('wa:bridge-message', (event as CustomEvent<string>).detail)
})

ipcRenderer.on('wa:bridge-command', (_event, detail: unknown) => {
  if (typeof detail !== 'string') return
  document.dispatchEvent(new CustomEvent('watis:bridge-in', { detail }))
})

// --- main -> page -----------------------------------------------------------

ipcRenderer.on('wa:notification-event', (_event, payload: unknown) => {
  document.dispatchEvent(new CustomEvent('watis:notify-event', { detail: JSON.stringify(payload) }))
})

ipcRenderer.on('wa:set-audio-sink', (_event, deviceId: unknown) => {
  const id = typeof deviceId === 'string' ? deviceId : ''
  void webFrame.executeJavaScript(
    `window.__watisApplySink && window.__watisApplySink(${JSON.stringify(id)})`,
  )
})

ipcRenderer.on('wa:set-enter-newline', (_event, enabled: unknown) => {
  void webFrame.executeJavaScript(
    `window.__watisEnterKeyInsertsNewline = ${String(Boolean(enabled))}`,
  )
})

// --- unread count -----------------------------------------------------------

let lastSerialised = ''

async function reportUnread(): Promise<void> {
  const counts = (await readUnreadFromIndexedDb()) ?? readUnreadFromTitle()
  const serialised = JSON.stringify(counts)
  if (serialised === lastSerialised) return
  lastSerialised = serialised
  ipcRenderer.send('wa:unread', counts)
}

// --- which chat is on screen -------------------------------------------------

let lastActiveChat = ''
function reportActiveChat(): void {
  const title = activeChatTitle()
  if (title === lastActiveChat) return
  lastActiveChat = title
  ipcRenderer.send('wa:active-chat', title)
}

// --- download filenames ------------------------------------------------------

/**
 * Electron's downloadItem.getFilename() collapses to the literal "download" for any blob: URL
 * whose suggested name contains a non-ASCII character — which, for a German archive, is most of
 * them. WhatsApp downloads media through `<a download>` on a blob: URL, so the real name is read
 * off the anchor here, in capture phase, before the click reaches the page.
 */
document.addEventListener(
  'click',
  (event) => {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest('a[download]')
    if (!anchor) return
    const name = anchor.getAttribute('download')?.trim()
    if (name) ipcRenderer.send('wa:download-name', name)
  },
  true,
)

// --- exposed API -------------------------------------------------------------

const api = {
  /** Diagnostics for the settings panel: did the main-world shim survive? */
  shimHealthy: (): Promise<boolean> =>
    webFrame.executeJavaScript('window.__watisNotificationShim === true') as Promise<boolean>,
}

contextBridge.exposeInMainWorld('watisWa', api)
export type WaPreloadApi = typeof api

// --- lifecycle ---------------------------------------------------------------

window.addEventListener('DOMContentLoaded', () => {
  void reportUnread()
  reportActiveChat()
  setInterval(() => {
    void reportUnread()
    reportActiveChat()
  }, 2000)
})
