import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type ArchiveChat, type ArchiveHit, type ArchiveMessage } from '../api'
import { pageDirection, scrollTopAfterPrepend, visibleRange } from './virtual-list'

/**
 * The archive view: chat list, virtualised message list, search.
 *
 * Everything here is bounded (§3.1). The message list renders a window, pages by keyset as the user
 * scrolls, and search always carries a limit — "load everything" is not an option the UI can reach.
 */

const ROW_HEIGHT = 76
const PAGE_SIZE = 60

async function ask<T>(request: unknown): Promise<T> {
  return (await api().archive(request)) as T
}

function formatWhen(ts: number): string {
  const d = new Date(ts * 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function MessageRow({ message }: { message: ArchiveMessage }): React.JSX.Element {
  return (
    <li
      className={`flex flex-col gap-0.5 border-b border-wa-hairline px-4 py-2 ${
        message.fromMe ? 'items-end text-right' : ''
      }`}
      style={{ height: ROW_HEIGHT }}
    >
      <div className="text-xs text-wa-muted">
        {message.fromMe ? 'Du' : (message.senderJid ?? 'Unbekannt')} · {formatWhen(message.ts)}
        {message.edited ? ' · bearbeitet' : ''}
      </div>
      <div className={`line-clamp-2 text-sm ${message.revoked ? 'italic text-wa-muted' : ''}`}>
        {message.revoked ? 'Diese Nachricht wurde gelöscht.' : (message.body ?? '(Anhang)')}
      </div>
    </li>
  )
}

export function ArchivePanel(): React.JSX.Element {
  const [chats, setChats] = useState<ArchiveChat[]>([])
  const [chatId, setChatId] = useState<string | undefined>(undefined)
  const [messages, setMessages] = useState<ArchiveMessage[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ArchiveHit[] | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const [loading, setLoading] = useState(false)

  const listRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  // Guards against firing a second page request while the first is still in flight.
  const fetching = useRef(false)

  useEffect(() => {
    void ask<{ chats: ArchiveChat[] }>({ op: 'chats', limit: 200 })
      .then((r) => {
        setChats(r.chats)
        setChatId((current) => current ?? r.chats[0]?.id)
      })
      .catch((e: unknown) => {
        setError(String(e))
      })
  }, [])

  const loadChat = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const r = await ask<{ messages: ArchiveMessage[] }>({
        op: 'messagesPage',
        chatId: id,
        limit: PAGE_SIZE,
      })
      // The repository returns newest-first; the list reads top-to-bottom oldest-first.
      setMessages([...r.messages].reverse())
      setScrollTop(Number.MAX_SAFE_INTEGER)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (chatId) void loadChat(chatId)
  }, [chatId, loadChat])

  const loadOlder = useCallback(async () => {
    const oldest = messages[0]
    if (!chatId || !oldest || fetching.current) return
    fetching.current = true
    try {
      const r = await ask<{ messages: ArchiveMessage[] }>({
        op: 'messagesPage',
        chatId,
        limit: PAGE_SIZE,
        before: { ts: oldest.ts, id: oldest.id },
      })
      if (r.messages.length > 0) {
        const older = [...r.messages].reverse()
        setMessages((current) => [...older, ...current])
        // Keep what the reader is looking at exactly where it was.
        setScrollTop((top) => scrollTopAfterPrepend(top, older.length, ROW_HEIGHT))
      }
    } catch (e) {
      setError(String(e))
    } finally {
      fetching.current = false
    }
  }, [chatId, messages])

  const onScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const top = event.currentTarget.scrollTop
      setScrollTop(top)
      const direction = pageDirection({
        count: messages.length,
        rowHeight: ROW_HEIGHT,
        viewportHeight,
        scrollTop: top,
      })
      if (direction === 'older') void loadOlder()
    },
    [loadOlder, messages.length, viewportHeight],
  )

  const runSearch = useCallback(async () => {
    if (query.trim() === '') {
      setHits(undefined)
      return
    }
    setLoading(true)
    try {
      const r = await ask<{ hits: ArchiveHit[] }>({ op: 'search', query, limit: 100 })
      setHits(r.hits)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [query])

  // Ctrl+K focuses search from anywhere in the panel.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  useEffect(() => {
    const element = listRef.current
    if (!element) return
    const observer = new ResizeObserver(() => {
      setViewportHeight(element.clientHeight)
    })
    observer.observe(element)
    setViewportHeight(element.clientHeight)
    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    const element = listRef.current
    if (element && scrollTop === Number.MAX_SAFE_INTEGER) element.scrollTop = element.scrollHeight
    else if (element && Math.abs(element.scrollTop - scrollTop) > 1) element.scrollTop = scrollTop
  }, [scrollTop, messages.length])

  const window_ = useMemo(
    () =>
      visibleRange({ count: messages.length, rowHeight: ROW_HEIGHT, viewportHeight, scrollTop }),
    [messages.length, viewportHeight, scrollTop],
  )

  return (
    <div className="flex h-full min-h-0 gap-3">
      <aside className="flex w-56 shrink-0 flex-col overflow-y-auto rounded-lg border border-wa-hairline">
        {chats.map((chat) => (
          <button
            key={chat.id}
            type="button"
            onClick={() => {
              setChatId(chat.id)
            }}
            className={`truncate px-3 py-2 text-left text-sm hover:bg-wa-hairline/40 ${
              chat.id === chatId ? 'bg-wa-hairline/60 font-medium' : ''
            }`}
          >
            {chat.name ?? chat.id}
          </button>
        ))}
        {chats.length === 0 && (
          <p className="p-3 text-sm text-wa-muted">
            Noch nichts archiviert. Das Archiv füllt sich, sobald die Bridge läuft.
          </p>
        )}
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <div className="flex gap-2">
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runSearch()
              if (e.key === 'Escape') {
                setQuery('')
                setHits(undefined)
              }
            }}
            placeholder="Suchen — von:, in:, vor:, nach:, hat:, quelle:   (Strg+K)"
            className="flex-1 rounded-md border border-wa-hairline bg-transparent px-3 py-1.5 text-sm"
            aria-label="Archiv durchsuchen"
          />
          <button
            type="button"
            onClick={() => {
              void runSearch()
            }}
            className="rounded-md border border-wa-hairline px-3 py-1.5 text-sm"
          >
            Suchen
          </button>
        </div>

        {error !== undefined && (
          <p
            role="alert"
            className="rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-500"
          >
            {error}
          </p>
        )}

        {hits ? (
          <ul className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-wa-hairline">
            {hits.length === 0 && <li className="p-3 text-sm text-wa-muted">Keine Treffer.</li>}
            {hits.map((hit) => (
              <li
                key={`${hit.source}:${hit.msgId ?? hit.mediaId ?? ''}`}
                className="border-b border-wa-hairline px-3 py-2"
              >
                <div className="text-xs text-wa-muted">
                  {hit.ts !== null ? formatWhen(hit.ts) : '—'} · gefunden in {hit.source}
                </div>
                <button
                  type="button"
                  className="text-left text-sm underline-offset-2 hover:underline"
                  onClick={() => {
                    if (hit.chatId) setChatId(hit.chatId)
                    setHits(undefined)
                  }}
                >
                  Im Chat öffnen
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div
            ref={listRef}
            onScroll={onScroll}
            className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-wa-hairline"
          >
            <div style={{ height: window_.paddingTop }} />
            <ul>
              {messages.slice(window_.startIndex, window_.endIndex).map((m) => (
                <MessageRow key={m.id} message={m} />
              ))}
            </ul>
            <div style={{ height: window_.paddingBottom }} />
            {messages.length === 0 && !loading && (
              <p className="p-3 text-sm text-wa-muted">Keine Nachrichten in diesem Chat.</p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
