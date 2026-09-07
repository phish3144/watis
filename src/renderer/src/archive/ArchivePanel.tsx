import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type ArchiveChat, type ArchiveHit, type ArchiveMessage } from '../api'
import { pageDirection, scrollTopAfterPrepend, visibleRange } from './virtual-list'
import { BackfillPanel } from '../components/BackfillPanel'
import type { HitPreview, NameHit } from '../../../workers/archive/repository'
import { Gallery } from './Gallery'
import { FirstRun } from './FirstRun'

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
/**
 * "Remind me about this" — a local note, nothing sent anywhere (PLAN.md Phase 8).
 *
 * Offers a few intervals rather than a date picker. A reminder about a message is nearly always
 * "later today" or "tomorrow"; making somebody pick a date and a time for that is the kind of
 * thoroughness that stops a feature from being used.
 */
function RemindButton({ msgId }: { msgId: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<string | undefined>(undefined)

  const set = (hours: number, label: string): void => {
    void ask({
      op: 'addReminder',
      msgId,
      dueTs: Math.floor(Date.now() / 1000) + Math.round(hours * 3600),
    })
      .then(() => {
        setDone(label)
        setOpen(false)
      })
      .catch((e: unknown) => {
        setDone(String(e))
      })
  }

  if (done) return <span className="text-xs text-wa-muted">Erinnerung: {done}</span>

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className="underline-offset-2 hover:underline"
        aria-expanded={open}
        onClick={() => {
          setOpen((was) => !was)
        }}
      >
        Erinnern
      </button>
      {open &&
        (
          [
            [3, 'in 3 Stunden'],
            [24, 'morgen'],
            [24 * 7, 'nächste Woche'],
          ] as const
        ).map(([hours, label]) => (
          <button
            key={label}
            type="button"
            className="rounded-full border border-wa-hairline px-2 py-0.5 text-[11px] text-wa-muted hover:text-slate-200"
            onClick={() => {
              set(hours, label)
            }}
          >
            {label}
          </button>
        ))}
    </span>
  )
}

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
    // Stored on a 0–1 scale (the OCR engine divides tesseract's 0–100 down before writing it).
    // Rendering it raw as a percentage turned a 91 %-confident line into "1 % sicher".
    parts.push(`${String(Math.round(preview.confidence * 100))} % sicher`)
  }
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * The picture a hit came from, with the recognised line marked (PLAN.md Phase 7).
 *
 * Fetched on demand and never with the hit list: sixty hits would mean sixty images loaded for the
 * one somebody actually wanted to see. The box comes from the OCR result in image coordinates, so
 * it is drawn as a percentage of the natural size — the picture is scaled to fit and the marker has
 * to scale with it.
 */
function HitImage({ preview }: { preview: HitPreview }): React.JSX.Element {
  const [image, setImage] = useState<string | null | undefined>(undefined)
  const [size, setSize] = useState<{ width: number; height: number } | undefined>(undefined)

  useEffect(() => {
    const mediaId = preview.key.split(':')[1]
    if (!mediaId) {
      setImage(null)
      return
    }
    void api()
      .files.hitImage(mediaId, preview.page)
      .then((result) => {
        setImage(result?.dataUrl ?? null)
      })
      .catch(() => {
        setImage(null)
      })
  }, [preview.key, preview.page])

  if (image === undefined) return <p className="py-1 text-xs text-wa-muted">Lade Bild …</p>
  if (image === null) {
    return <p className="py-1 text-xs text-wa-muted">Die Datei liegt nicht im Archiv.</p>
  }

  // Only for an OCR hit on the image itself: a rendered PDF page has different dimensions from the
  // ones the box was measured in, so drawing it there would put the marker in the wrong place.
  const box = preview.page === undefined ? preview.box : undefined

  return (
    <div className="relative mt-1 inline-block max-w-full">
      <img
        src={image}
        alt=""
        className="max-h-80 max-w-full rounded-md border border-wa-hairline"
        onLoad={(e) => {
          setSize({
            width: e.currentTarget.naturalWidth,
            height: e.currentTarget.naturalHeight,
          })
        }}
      />
      {box && size && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute rounded-sm border-2 border-wa-accent"
          style={{
            left: `${String((box[0] / size.width) * 100)}%`,
            top: `${String((box[1] / size.height) * 100)}%`,
            width: `${String(((box[2] - box[0]) / size.width) * 100)}%`,
            height: `${String(((box[3] - box[1]) / size.height) * 100)}%`,
          }}
        />
      )}
    </div>
  )
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
  const [showImage, setShowImage] = useState(false)
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
        {hit.msgId && <RemindButton msgId={hit.msgId} />}
        {preview && hit.mediaId && (preview.source === 'ocr' || preview.source === 'pdf') && (
          <button
            type="button"
            className="underline-offset-2 hover:underline"
            aria-expanded={showImage}
            onClick={() => {
              setShowImage((was) => !was)
            }}
          >
            {showImage ? 'Stelle ausblenden' : 'Stelle zeigen'}
          </button>
        )}
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
      {showImage && preview && <HitImage preview={preview} />}

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
  /** How many messages the archive holds, so an empty result can say which kind of empty it is. */
  const [archiveMessages, setArchiveMessages] = useState<number | undefined>(undefined)
  /**
   * How far the content index has got. Without this, "Text in Bildern" and "PDFs" find nothing and
   * the panel gives no way to tell "not processed yet" from "not working" — the same complaint,
   * for the third subsystem in a row.
   */
  const [indexPending, setIndexPending] = useState<number | undefined>(undefined)
  const [messages, setMessages] = useState<ArchiveMessage[]>([])
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ArchiveHit[] | undefined>(undefined)
  const [previews, setPreviews] = useState<Record<string, HitPreview>>({})
  const [names, setNames] = useState<NameHit[]>([])
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

  /**
   * The chat list, kept current.
   *
   * This used to run once on mount and never again. On a fresh install the archive is empty at that
   * moment, so the panel showed "Noch nichts archiviert" and went on showing it while chats piled up
   * underneath — until the user happened to switch tabs, which remounts this component, or restarted
   * the application. An archive view that does not notice the archive filling up is the same bug as
   * a status dot that never turns green: the work happens, nothing says so.
   *
   * Five seconds. The query is a LIMIT 200 read against a local SQLite file on a worker thread.
   */
  useEffect(() => {
    let cancelled = false
    let first = true

    const load = (): void => {
      void api()
        .getIndexStatus()
        .then(
          (status) => {
            const counts = (status as { counts?: Record<string, number> } | null)?.counts
            if (!cancelled && counts) {
              setIndexPending((counts.pending ?? 0) + (counts.running ?? 0))
            }
          },
          () => {
            /* the health banner covers a worker that is not answering */
          },
        )
      void ask<{ messages: number }>({ op: 'stats' }).then(
        (r) => {
          if (!cancelled) setArchiveMessages(r.messages)
        },
        () => {
          /* the health banner covers a worker that is not answering */
        },
      )
      void ask<{ chats: ArchiveChat[] }>({ op: 'chats', limit: 200 })
        .then((r) => {
          if (cancelled) return
          // Replaced only when it actually changed, so a poll every five seconds does not re-render
          // a two-hundred-row list for nothing.
          setChats((current) =>
            current.length === r.chats.length &&
            current.every((c, i) => c.id === r.chats[i]?.id && c.name === r.chats[i]?.name)
              ? current
              : r.chats,
          )
          // Picks the first chat as soon as there IS one — not only if one existed at mount, which
          // was the case that left a populated list beside a blank, unexplained message pane.
          setChatId((chosen) => chosen ?? r.chats[0]?.id)
          first = false
        })
        .catch((e: unknown) => {
          // Only the first attempt is worth a message. A later failure means the archive worker is
          // restarting, which the health banner already reports; overwriting the view with an error
          // string every five seconds would be worse than showing the last good list.
          if (!cancelled && first) setError(String(e))
        })
    }

    load()
    const timer = setInterval(load, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
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

  /**
   * The open chat, kept current.
   *
   * loadChat runs when the selection changes and never again, so a chat opened while the mirror was
   * running showed the messages it had at that instant and then stood still. For an archive whose
   * whole purpose is writing along as messages arrive, a view that does not show them arriving is
   * the feature not working.
   *
   * Only genuinely new rows are appended, and the scroll position is left alone unless the reader
   * was already at the bottom — yanking somebody back down every five seconds while they read
   * something older would be worse than not updating at all.
   */
  useEffect(() => {
    if (!chatId) return
    let cancelled = false

    const tail = (): void => {
      const element = listRef.current
      const wasAtBottom = element
        ? element.scrollHeight - element.scrollTop - element.clientHeight < ROW_HEIGHT * 1.5
        : true

      void ask<{ messages: ArchiveMessage[] }>({
        op: 'messagesPage',
        chatId,
        limit: PAGE_SIZE,
      })
        .then((r) => {
          if (cancelled) return
          const newest = [...r.messages].reverse()
          setMessages((current) => {
            if (current.length === 0) return newest
            const known = new Set(current.map((m) => m.id))
            const added = newest.filter((m) => !known.has(m.id))
            if (added.length === 0) return current
            return [...current, ...added]
          })
          if (wasAtBottom) setScrollTop(Number.MAX_SAFE_INTEGER)
        })
        .catch(() => {
          // A failing read means the archive worker is restarting. The health banner says so; the
          // messages already on screen stay where they are.
        })
    }

    const timer = setInterval(tail, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [chatId])

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
      setNames([])
      return
    }
    setLoading(true)
    try {
      const r = await ask<{ hits: ArchiveHit[] }>({ op: 'search', query, limit: 100 })
      setHits(r.hits)

      // Names are a different kind of answer from messages and come from a different query, so a
      // chat called "Rechnungen" does not have to out-rank every message about an invoice.
      const found = await ask<{ names: NameHit[] }>({ op: 'names', query, limit: 8 })
      setNames(found.names)

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
    // One column, not two.
    //
    // This was a master/detail row with a fixed 224px chat list beside everything else. The panel
    // is capped at 460px wide by construction — Math.min(PANEL_WIDTH, width/2) in main-window.ts —
    // so the right-hand side never got more than about 200px no matter the monitor. The search
    // field, the date jump and the filter chips were permanently crushed into a strip. There was no
    // window size at which that layout came right, which makes it the wrong layout rather than an
    // untuned one.
    //
    // Stacked, every control gets the full width, and the two scrolling regions are bounded: the
    // chat list takes a fixed slice at the top and the results take everything below it.
    <div className="flex h-full min-h-0 flex-col gap-3">
      <FirstRun />

      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex shrink-0 flex-col gap-2">
          <aside className="flex max-h-44 min-h-0 flex-col overflow-y-auto rounded-lg border border-wa-hairline">
            {chats.map((chat) => (
              <button
                key={chat.id}
                type="button"
                onClick={() => {
                  setChatId(chat.id)
                }}
                // shrink-0 matters: this is a flex column with a bounded height, so without it
                // the rows compress into unreadable slivers rather than letting the list scroll.
                className={`shrink-0 truncate px-3 py-2 text-left text-sm hover:bg-wa-hairline/40 ${
                  chat.id === chatId ? 'bg-wa-hairline/60 font-medium' : ''
                }`}
              >
                {chat.name ?? chat.id}
              </button>
            ))}
            {chats.length === 0 && (
              <p className="p-3 text-sm text-wa-muted">
                Noch nichts archiviert. Sobald WhatsApp Web geladen und verknüpft ist, schreibt
                WatIs? jede neue Nachricht mit. Was WhatsApp jetzt schon im Speicher hat, holt
                „Jetzt übernehmen" unter <em>Nachladen</em> in einem Zug herein.
              </p>
            )}
          </aside>
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
              placeholder="Im ganzen Archiv suchen — von:, in:, vor:, nach:, hat:, quelle:   (Strg+K)"
              className="flex-1 rounded-md border border-wa-hairline bg-transparent px-3 py-1.5 text-sm"
              aria-label="Im ganzen Archiv suchen, über alle Chats"
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
              {names.length > 0 && (
                <li className="border-b border-wa-hairline bg-wa-surface px-3 py-2">
                  <div className="mb-1 text-[11px] uppercase tracking-wide text-wa-muted">
                    Chats und Kontakte
                  </div>
                  <ul className="flex flex-wrap gap-2 text-sm">
                    {names.map((name) => (
                      <li key={`${name.kind}:${name.id}`}>
                        <button
                          type="button"
                          className="rounded-md border border-wa-hairline px-2 py-0.5 hover:border-wa-accent"
                          onClick={() => {
                            if (name.kind === 'chat') {
                              setChatId(name.id)
                              setHits(undefined)
                            } else {
                              // A contact is not a chat: filtering by sender is the honest action,
                              // because that person may appear in several chats.
                              setQuery(`von:${name.id}`)
                            }
                          }}
                        >
                          {name.label}
                          <span className="ml-1 text-[11px] text-wa-muted">
                            {name.kind === 'chat' ? 'Chat' : 'Kontakt'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              )}
              {hits.length === 0 && names.length === 0 && (
                // "Keine Treffer" over an empty archive is a true sentence that answers the wrong
                // question: it sounds like the archive was searched and the word is not in it. The
                // first person to try this searched an archive holding nothing and reasonably
                // concluded the search was broken.
                <li className="p-3 text-sm text-wa-muted">
                  {archiveMessages === 0
                    ? 'Es ist noch keine Nachricht archiviert — es gibt also noch nichts zu durchsuchen. Die Suche geht später über alle Chats auf einmal.'
                    : 'Keine Treffer. Gesucht wurde im ganzen Archiv, über alle Chats; der links ausgewählte Chat schränkt nichts ein. Nur „in:Name" tut das.'}
                  {/* Text lives in the messages and is searchable the moment they arrive. Text
                      inside images and PDFs has to be extracted first, which happens in the
                      background and takes a while — saying so is the difference between "be
                      patient" and "this feature is broken". */}
                  {indexPending !== undefined && indexPending > 0 && (
                    <span className="mt-1 block">
                      Text in Bildern und PDFs ist noch nicht vollständig durchsuchbar:{' '}
                      {indexPending.toLocaleString('de-DE')} Medien warten noch auf die
                      Texterkennung. Nachrichtentext selbst ist sofort durchsuchbar.
                    </span>
                  )}
                </li>
              )}
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

        {/*
          Last, and collapsed. Backfilling is a maintenance action somebody runs once and then
          forgets; it used to sit between the chat list and the search box, where it was in the way
          of both without being any easier to find.
        */}
        <details className="shrink-0 rounded-lg border border-wa-hairline">
          <summary className="cursor-pointer px-3 py-2 text-xs">
            Ältere Nachrichten nachladen
          </summary>
          <BackfillPanel chats={chats} />
        </details>
      </div>
    </div>
  )
}
