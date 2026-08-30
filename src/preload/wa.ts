import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { ENTER_KEY_SHIM, NOTIFICATION_SHIM } from './wa-notification-shim'

/**
 * Preload for the WhatsApp view. Runs in the isolated world, sandboxed, CommonJS.
 *
 * It does three things and nothing else:
 *  1. installs the main-world shims (notifications, Enter key) before any page script runs,
 *  2. reads the unread count out of WhatsApp's own IndexedDB,
 *  3. relays between the page and the main process.
 *
 * It never writes to WhatsApp. The read-only bridge into WhatsApp's internal stores is a
 * separate, later thing and lives in the page world; this file will not grow into it.
 */

// Main-world injection. Must happen at top level: WhatsApp captures window.Notification while
// its bundle evaluates, so anything later is too late.
void webFrame.executeJavaScript(NOTIFICATION_SHIM)
void webFrame.executeJavaScript(ENTER_KEY_SHIM)

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

// --- main -> page -----------------------------------------------------------

ipcRenderer.on('wa:notification-event', (_event, payload: unknown) => {
  document.dispatchEvent(new CustomEvent('watis:notify-event', { detail: JSON.stringify(payload) }))
})

ipcRenderer.on('wa:set-enter-newline', (_event, enabled: unknown) => {
  void webFrame.executeJavaScript(
    `window.__watisEnterKeyInsertsNewline = ${String(Boolean(enabled))}`,
  )
})

// --- unread count -----------------------------------------------------------

interface UnreadCounts {
  unread: number
  mutedUnread: number
  chats: number
  source: 'indexeddb' | 'title' | 'unavailable'
}

interface ChatRow {
  unreadCount?: number
  archive?: boolean
  muteExpiration?: number
  isAutoMuted?: boolean
}

/**
 * Primary source: WhatsApp's own `model-storage` database. Storage is shared per origin, so the
 * isolated world can read it without touching the page's JavaScript at all.
 *
 * The schema is WhatsApp's private, unversioned internals and can change without notice, so a
 * failure falls back to parsing the document title rather than throwing.
 */
async function readUnreadFromIndexedDb(): Promise<UnreadCounts | undefined> {
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('model-storage')
      request.onsuccess = () => {
        resolve(request.result)
      }
      request.onerror = () => {
        reject(request.error ?? new Error('indexedDB.open failed'))
      }
      request.onblocked = () => {
        reject(new Error('indexedDB.open blocked'))
      }
    })
    if (!db.objectStoreNames.contains('chat')) return undefined

    const rows = await new Promise<ChatRow[]>((resolve, reject) => {
      const query = db.transaction('chat', 'readonly').objectStore('chat').getAll()
      query.onsuccess = () => {
        resolve(query.result as ChatRow[])
      }
      query.onerror = () => {
        reject(query.error ?? new Error('getAll failed'))
      }
    })
    db.close()

    let unread = 0
    let mutedUnread = 0
    let chats = 0
    for (const row of rows) {
      const count = row.unreadCount ?? 0
      if (count <= 0 || row.archive) continue
      chats += 1
      if ((row.muteExpiration ?? 0) !== 0 || row.isAutoMuted) mutedUnread += count
      else unread += count
    }
    return { unread, mutedUnread, chats, source: 'indexeddb' }
  } catch {
    return undefined
  }
}

/** Fallback. The title is a "(3) WhatsApp" style string; anything unparseable counts as zero. */
function readUnreadFromTitle(): UnreadCounts {
  const match = /^\((\d+)\)/.exec(document.title)
  const unread = match?.[1] ? Number.parseInt(match[1], 10) : 0
  return { unread, mutedUnread: 0, chats: unread > 0 ? 1 : 0, source: 'title' }
}

let lastSerialised = ''

async function reportUnread(): Promise<void> {
  const counts = (await readUnreadFromIndexedDb()) ?? readUnreadFromTitle()
  const serialised = JSON.stringify(counts)
  if (serialised === lastSerialised) return
  lastSerialised = serialised
  ipcRenderer.send('wa:unread', counts)
}

// --- which chat is on screen -------------------------------------------------

/**
 * Used to suppress a toast for the chat the user is already looking at. Read from the page's
 * own DOM, never from its internals.
 *
 * Deliberately NOT a MutationObserver on a wide subtree: an observer whose callback writes into
 * the tree it observes wedges the renderer permanently and silently (measured on Electron 44).
 * Polling a single attribute is cheap and cannot deadlock.
 */
function activeChatTitle(): string {
  const header = document.querySelector('header [role="button"] span[title]')
  return header?.getAttribute('title') ?? ''
}

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
