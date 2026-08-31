import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type ArchiveChat, type ArchiveHit, type ArchiveMessage } from '../api'
import { pageDirection, scrollTopAfterPrepend, visibleRange } from './virtual-list'
import { BackfillPanel } from '../components/BackfillPanel'
import type { HitPreview } from '../../../workers/archive/repository'
import { Gallery } from './Gallery'

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

/**
 * One search hit with the three messages either side of it.
 *
 * The context is fetched when the row is expanded, not with the hit list: a page of 60 hits would
 * otherwise mean 60 extra queries for context nobody looked at.
 */
/** Human names for the index sources, so a hit says where it came from in plain German. */
const SOURCE_LABEL: Record<string, string> = {
  body: 'Nachricht',
  filename: 'Dateiname',
  ocr: 'Text im Bild',
  pdf: 'PDF',
  docx: 'Dokument',
  text: 'Textdatei',
  transcript: 'Sprachnachricht',
}

/** Where in the file the hit sits, when the engine recorded it. */
function whereIn(preview: HitPreview | undefined): string | undefined {
  if (!preview) return undefined
  const parts: string[] = []
  if (preview.page !== undefined) parts.push(`Seite ${String(preview.page)}`)
  if (preview.startSeconds !== undefined) {
    const total = Math.floor(preview.startSeconds)
    parts.push(`bei ${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`)
  }
  if (preview.confidence !== undefined) {
    parts.push(`${String(Math.round(preview.confidence))}% sicher`)
  }
  return parts.length > 0 ? parts.join(' · ') : undefined
}

function HitRow({
  hit,
  preview,
  onOpenInArchive,
}: {
  hit: ArchiveHit
  preview: HitPreview | undefined
  onOpenInArchive: () => void
}): React.JSX.Element {
  const [context, setContext] = useState<ArchiveMessage[] | undefined>(undefined)
  const [open, setOpen] = useState(false)
  const [waError, setWaError] = useState<string | undefined>(undefined)
  // Bound where the chat id is still known to be there, so the handler needs no null check of
  // its own — and a hit without a chat simply has no button.
  const chatId = hit.chatId
  const openInWhatsApp =
    chatId === null
      ? undefined
      : (): void => {
          setWaError(undefined)
          void api()
            .bridge.openChat(chatId, hit.msgId ?? undefined)
            .catch((error: unknown) => {
              setWaError(String(error))
            })
        }

  const expand = (): void => {
    setOpen((was) => !was)
    if (context !== undefined || !hit.msgId) return
    void ask<{ messages: ArchiveMessage[] }>({ op: 'context', msgId: hit.msgId, radius: 3 })
      .then((result) => {
        setContext(result.messages)
      })
      .catch(() => {
        setContext([])
      })
  }

  return (
    <li className="border-b border-wa-hairline px-3 py-2">
      <div className="text-xs text-wa-muted">
        {hit.ts !== null ? formatWhen(hit.ts) : '—'} · {SOURCE_LABEL[hit.source] ?? hit.source}
        {preview?.filename ? ` · ${preview.filename}` : ''}
      </div>

      {preview?.text ? (
        <p className="line-clamp-3 py-0.5 text-sm">{preview.text}</p>
      ) : (
        <p className="py-0.5 text-sm text-wa-muted">Keine Vorschau.</p>
      )}
      {whereIn(preview) && <p className="text-[11px] text-wa-muted">{whereIn(preview)}</p>}

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          className="underline-offset-2 hover:underline"
          onClick={onOpenInArchive}
        >
          Im Archiv öffnen
        </button>
        <button
          type="button"
          className="underline-offset-2 hover:underline"
          onClick={expand}
          aria-expanded={open}
        >
          {open ? 'Umgebung ausblenden' : 'Umgebung zeigen'}
        </button>
        {openInWhatsApp && (
          <button
            type="button"
            className="underline-offset-2 hover:underline"
            onClick={openInWhatsApp}
          >
            In WhatsApp öffnen
          </button>
        )}
      </div>

      {waError !== undefined && <p className="text-xs text-red-400">{waError}</p>}

      {open && (
        <ol className="mt-1 border-l border-wa-hairline pl-3 text-xs">
          {context === undefined && <li className="text-wa-muted">Lade Umgebung …</li>}
          {context?.length === 0 && <li className="text-wa-muted">Keine Umgebung im Archiv.</li>}
          {context?.map((m) => (
            <li
              key={m.id}
              className={m.id === hit.msgId ? 'py-0.5 text-slate-200' : 'py-0.5 text-wa-muted'}
            >
              <span className="tabular-nums">{formatWhen(m.ts)}</span>{' '}
              {m.revoked ? <em>gelöscht</em> : (m.body ?? '(Anhang)')}
            </li>
          ))}
        </ol>
      )}
    </li>
  )
}

export function ArchivePanel(): React.JSX.Element {
  const [chats, setChats] = useState<ArchiveChat[]>([])
  const [chatId, setChatId] = useState<string | undefined>(undefined)
  const [messages, setMessages] = useState<ArchiveMessage[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ArchiveHit[] | undefined>(undefined)
  const [previews, setPreviews] = useState<Record<string, HitPreview>>({})
  const [view, setView] = useState<'messages' | 'gallery'>('messages')
  const [jumpTo, setJumpTo] = useState('')
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

  /**
   * Jumps to a day rather than scrolling to it. The list is reloaded from the first message at or
   * after that date, which is the same cursor the normal paging uses — so scrolling up from there
   * keeps working without a special case.
   */
  const jumpToDate = useCallback(async () => {
    if (!chatId || !jumpTo) return
    setError(undefined)
    try {
      const ts = Math.floor(new Date(`${jumpTo}T00:00:00`).getTime() / 1000)
      const found = await ask<{ cursor: { id: string; ts: number } | null }>({
        op: 'jumpToDate',
        chatId,
        ts,
      })
      if (!found.cursor) {
        // Landing silently on the end would look like the jump worked and the chat simply stopped.
        setError('Nach diesem Datum ist in diesem Chat nichts archiviert.')
        return
      }
      const page = await ask<{ messages: ArchiveMessage[] }>({
        op: 'messagesPage',
        chatId,
        limit: PAGE_SIZE,
        after: { ts: found.cursor.ts - 1, id: '' },
      })
      setMessages(page.messages)
      setScrollTop(0)
      listRef.current?.scrollTo({ top: 0 })
    } catch (e) {
      setError(String(e))
    }
  }, [chatId, jumpTo])

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
      setPreviews({})
      return
    }
    setLoading(true)
    try {
      const r = await ask<{ hits: ArchiveHit[] }>({ op: 'search', query, limit: 100 })
      setHits(r.hits)

      // Previews come in one request for the whole page rather than one per row: a hundred hits
      // would otherwise be a hundred round trips for text nobody has looked at yet.
      const terms = query
        .split(/\s+/)
        .filter((word) => word.length > 0 && !word.includes(':'))
        .slice(0, 20)
      const p = await ask<{ previews: HitPreview[] }>({
        op: 'hitPreviews',
        hits: r.hits.slice(0, 200).map((h) => ({
          msgId: h.msgId,
          mediaId: h.mediaId,
          source: h.source,
        })),
        terms,
      })
      setPreviews(Object.fromEntries(p.previews.map((preview) => [preview.key, preview])))
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
      <div className="flex w-56 shrink-0 flex-col gap-2">
        <aside className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border border-wa-hairline">
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

        <details className="shrink-0 rounded-lg border border-wa-hairline">
          <summary className="cursor-pointer px-3 py-2 text-xs">Nachladen</summary>
          <BackfillPanel chats={chats} />
        </details>
      </div>

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

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {(
            [
              ['messages', 'Verlauf'],
              ['gallery', 'Galerie'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => {
                setView(value)
              }}
              className={`rounded-full border px-2 py-0.5 ${
                view === value
                  ? 'border-wa-accent text-wa-accent'
                  : 'border-wa-hairline text-wa-muted hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}

          {view === 'messages' && chatId && (
            <label className="ml-auto flex items-center gap-1 text-wa-muted">
              Springe zu
              <input
                type="date"
                value={jumpTo}
                onChange={(e) => {
                  setJumpTo(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void jumpToDate()
                }}
                className="rounded-md border border-wa-hairline bg-transparent px-2 py-0.5"
                aria-label="Zu einem Datum springen"
              />
              <button
                type="button"
                disabled={!jumpTo}
                onClick={() => {
                  void jumpToDate()
                }}
                className="rounded-md border border-wa-hairline px-2 py-0.5 disabled:opacity-40"
              >
                Los
              </button>
            </label>
          )}
        </div>

        {/*
          Chips rather than a dropdown: they write into the same query string the user could have
          typed, so the syntax stays visible and learnable instead of being hidden behind a widget.
        */}
        <div className="flex flex-wrap gap-1 text-[11px]">
          {(
            [
              ['body', 'Nachrichten'],
              ['ocr', 'Text in Bildern'],
              ['pdf', 'PDFs'],
              ['transcript', 'Sprachnachrichten'],
            ] as const
          ).map(([value, label]) => {
            const token = `quelle:${value}`
            const active = query.includes(token)
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  const next = active
                    ? query
                        .replace(token, '')
                        .replace(/\s{2,}/g, ' ')
                        .trim()
                    : `${query.trim()} ${token}`.trim()
                  setQuery(next)
                }}
                className={`rounded-full border px-2 py-0.5 ${
                  active
                    ? 'border-wa-accent text-wa-accent'
                    : 'border-wa-hairline text-wa-muted hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            )
          })}
          {(query.includes('hat:') || query.includes('quelle:')) && (
            <button
              type="button"
              onClick={() => {
                setQuery(
                  query
                    .split(/\s+/)
                    .filter((word) => !word.startsWith('quelle:') && !word.startsWith('hat:'))
                    .join(' ')
                    .trim(),
                )
              }}
              className="rounded-full border border-wa-hairline px-2 py-0.5 text-wa-muted hover:text-slate-200"
            >
              Filter zurücksetzen
            </button>
          )}
        </div>

        {error !== undefined && (
          <p
            role="alert"
            className="rounded-md border border-red-500/40 px-3 py-2 text-sm text-red-500"
          >
            {error}
          </p>
        )}

        {view === 'gallery' && !hits ? (
          <Gallery chatId={chatId} />
        ) : hits ? (
          <ul className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-wa-hairline">
            {hits.length === 0 && <li className="p-3 text-sm text-wa-muted">Keine Treffer.</li>}
            {hits.map((hit) => (
              <HitRow
                key={`${hit.source}:${hit.msgId ?? hit.mediaId ?? ''}`}
                hit={hit}
                preview={previews[`${hit.source}:${hit.msgId ?? hit.mediaId ?? ''}`]}
                onOpenInArchive={() => {
                  if (hit.chatId) setChatId(hit.chatId)
                  setHits(undefined)
                }}
              />
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
