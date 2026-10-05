/**
 * Reading what WhatsApp Web shows, without touching its JavaScript: the unread count from its own
 * IndexedDB and the open chat's title from the DOM.
 *
 * Shared by the desktop preload and the browser extension's content script. Both run in an
 * isolated world on the WhatsApp origin, so both see the same storage and the same document, and
 * neither needs the page world for this (ADR 0010).
 */

export interface UnreadCounts {
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
export async function readUnreadFromIndexedDb(): Promise<UnreadCounts | undefined> {
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
export function readUnreadFromTitle(): UnreadCounts {
  const match = /^\((\d+)\)/.exec(document.title)
  const unread = match?.[1] ? Number.parseInt(match[1], 10) : 0
  return { unread, mutedUnread: 0, chats: unread > 0 ? 1 : 0, source: 'title' }
}

/**
 * Used to suppress a toast for the chat the user is already looking at. Read from the page's
 * own DOM, never from its internals.
 *
 * Deliberately NOT a MutationObserver on a wide subtree: an observer whose callback writes into
 * the tree it observes wedges the renderer permanently and silently (measured on Electron 44).
 * Polling a single attribute is cheap and cannot deadlock.
 */
export function activeChatTitle(): string {
  const header = document.querySelector('header [role="button"] span[title]')
  return header?.getAttribute('title') ?? ''
}
