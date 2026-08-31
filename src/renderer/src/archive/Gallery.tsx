import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { GalleryItem } from '../../../workers/archive/repository'

/**
 * The media gallery for a chat (PLAN.md Phase 4): everything that was sent, by kind, newest first.
 *
 * Paged like every other list here. "Show all images in this chat" sounds harmless until the chat
 * is a family group with fifteen years in it (§3.1).
 */

const PAGE = 60

const KINDS = [
  ['image', 'Bilder'],
  ['video', 'Videos'],
  ['document', 'Dokumente'],
  ['audio', 'Sprachnachrichten'],
  ['link', 'Links'],
] as const

type Kind = (typeof KINDS)[number][0]

function formatWhen(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${String(bytes)} B`
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1).replace('.', ',')} MB` : `${Math.round(bytes / 1024)} KB`
}

/** The first URL in a message body, which is what a link entry is actually about. */
function firstUrl(text: string | null): string | undefined {
  return /https?:\/\/\S+/.exec(text ?? '')?.[0]
}

export function Gallery({ chatId }: { chatId: string | undefined }): React.JSX.Element {
  const [kind, setKind] = useState<Kind>('image')
  const [items, setItems] = useState<GalleryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [exhausted, setExhausted] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const load = useCallback(
    (beforeTs?: number): void => {
      setLoading(true)
      setError(undefined)
      void (
        api().archive({
          op: 'gallery',
          ...(chatId ? { chatId } : {}),
          kind,
          limit: PAGE,
          ...(beforeTs === undefined ? {} : { beforeTs }),
        }) as Promise<{ items: GalleryItem[] }>
      )
        .then((result) => {
          setItems((current) =>
            beforeTs === undefined ? result.items : [...current, ...result.items],
          )
          setExhausted(result.items.length < PAGE)
        })
        .catch((e: unknown) => {
          setError(String(e))
        })
        .finally(() => {
          setLoading(false)
        })
    },
    [chatId, kind],
  )

  // A new chat or a new kind starts a fresh list rather than appending to the previous one.
  useEffect(() => {
    setItems([])
    setExhausted(false)
    load()
  }, [load])

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div className="flex flex-wrap gap-1 text-[11px]">
        {KINDS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={kind === value}
            onClick={() => {
              setKind(value)
            }}
            className={`rounded-full border px-2 py-0.5 ${
              kind === value
                ? 'border-wa-accent text-wa-accent'
                : 'border-wa-hairline text-wa-muted hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error !== undefined && (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      )}

      <ul className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-wa-hairline">
        {items.length === 0 && !loading && (
          <li className="p-3 text-sm text-wa-muted">Nichts von dieser Art im Archiv.</li>
        )}
        {items.map((item) => (
          <li
            key={`${item.kind}:${item.mediaId ?? item.msgId ?? ''}`}
            className="flex items-baseline justify-between gap-3 border-b border-wa-hairline px-3 py-2 text-sm"
          >
            <span className="min-w-0 flex-1">
              {item.kind === 'link' ? (
                <span className="break-all">{firstUrl(item.text) ?? item.text}</span>
              ) : (
                <>
                  <span className="block truncate">{item.filename ?? '(ohne Namen)'}</span>
                  {item.text && (
                    <span className="block truncate text-xs text-wa-muted">{item.text}</span>
                  )}
                </>
              )}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-wa-muted">
              {formatSize(item.size)} {formatWhen(item.ts)}
            </span>
          </li>
        ))}
        {!exhausted && items.length > 0 && (
          <li className="p-2 text-center">
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                load(items[items.length - 1]?.ts)
              }}
              className="rounded-md border border-wa-hairline px-3 py-1 text-xs disabled:opacity-40"
            >
              {loading ? 'Lade …' : 'Ältere laden'}
            </button>
          </li>
        )}
      </ul>
    </div>
  )
}
