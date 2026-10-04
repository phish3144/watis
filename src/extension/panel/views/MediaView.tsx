import { useEffect, useState } from 'react'
import type { GalleryItem } from '../../../workers/archive/repository'
import { archive, fetchMedia, saveMedia } from '../api'
import { useChats } from '../hooks'
import { exactly, jidLabel, when } from '../format'
import { DownloadIcon, ImageIcon, LinkIcon } from '../icons'
import { Attachment, MediaProblemNote, pathOf, useBlobUrl } from '../media'
import { t } from '../strings'
import { EmptyState, Segmented, Spinner } from '../ui'

/** Everything shared across all chats, by kind, newest first and paged (§3.1). */

type Kind = GalleryItem['kind']

const KINDS: readonly { value: Kind; label: string }[] = [
  { value: 'image', label: t('media.images') },
  { value: 'video', label: t('media.videos') },
  { value: 'document', label: t('media.documents') },
  { value: 'audio', label: t('media.audio') },
  { value: 'link', label: t('media.links') },
]

const PAGE = 60

export function MediaView({
  onOpenChat,
}: {
  onOpenChat: (chatId: string, anchor?: { ts: number; id: string }) => void
}): React.JSX.Element {
  const [kind, setKind] = useState<Kind>('image')
  const [items, setItems] = useState<GalleryItem[]>([])
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(true)
  const { byId } = useChats()

  useEffect(() => {
    let alive = true
    setLoading(true)
    setItems([])
    archive<{ items: GalleryItem[] }>({ op: 'gallery', kind, limit: PAGE })
      .then((result) => {
        if (!alive) return
        setItems(result.items)
        setDone(result.items.length < PAGE)
      })
      .catch(() => {
        if (alive) setDone(true)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [kind])

  const more = (): void => {
    const last = items[items.length - 1]
    if (!last) return
    setLoading(true)
    void archive<{ items: GalleryItem[] }>({ op: 'gallery', kind, limit: PAGE, beforeTs: last.ts })
      .then((result) => {
        setItems((current) => [...current, ...result.items])
        setDone(result.items.length < PAGE)
      })
      .finally(() => {
        setLoading(false)
      })
  }

  const chatName = (item: GalleryItem): string =>
    (item.chatId ? byId.get(item.chatId)?.name : undefined) ?? jidLabel(item.chatId)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pb-3 pt-1">
        <div className="max-w-xl">
          <Segmented label={t('nav.media')} value={kind} options={KINDS} onChange={setKind} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {!loading && items.length === 0 && (
          <EmptyState icon={kind === 'link' ? <LinkIcon /> : <ImageIcon />}>
            {t('media.empty')}
          </EmptyState>
        )}
        {kind === 'image' ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-1.5">
            {items.map((item) => (
              <ImageTile
                key={`${item.mediaId ?? ''}:${item.msgId ?? ''}`}
                item={item}
                chatName={chatName(item)}
              />
            ))}
          </ul>
        ) : (
          <ul className="mx-auto max-w-3xl space-y-2">
            {items.map((item) => (
              <li
                key={`${item.mediaId ?? ''}:${item.msgId ?? ''}:${item.text ?? ''}`}
                className="rounded-2xl bg-wa-surface p-3"
              >
                <button
                  type="button"
                  onClick={() => {
                    if (item.chatId)
                      onOpenChat(
                        item.chatId,
                        item.msgId ? { ts: item.ts, id: item.msgId } : undefined,
                      )
                  }}
                  className="mb-1.5 flex w-full items-baseline justify-between gap-2 text-left"
                >
                  <span className="truncate text-xs font-semibold">{chatName(item)}</span>
                  <time className="shrink-0 text-[11px] text-wa-muted" title={exactly(item.ts)}>
                    {when(item.ts)}
                  </time>
                </button>
                {kind === 'link' ? (
                  <LinkItem text={item.text ?? ''} />
                ) : (
                  item.mediaId && (
                    <Attachment mediaId={item.mediaId} chatName={chatName(item)} ts={item.ts} />
                  )
                )}
              </li>
            ))}
          </ul>
        )}
        {loading && (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        )}
        {!loading && !done && items.length > 0 && (
          <div className="mt-3 flex justify-center">
            <button
              type="button"
              onClick={more}
              className="rounded-full px-4 py-1.5 text-xs font-medium text-wa-accent hover:bg-wa-accent-soft"
            >
              {t('media.more')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ImageTile({ item, chatName }: { item: GalleryItem; chatName: string }): React.JSX.Element {
  const [fetching, setFetching] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const path = pathOf(item)
  const url = useBlobUrl(path)

  if (url) {
    return (
      <li className="group relative aspect-square overflow-hidden rounded-lg bg-wa-raised">
        <img
          src={url}
          alt={item.text ?? item.filename ?? ''}
          loading="lazy"
          className="h-full w-full object-cover"
          title={`${chatName} · ${exactly(item.ts)}`}
        />
        <button
          type="button"
          aria-label={t('media.save')}
          title={t('media.save')}
          onClick={() => {
            if (path) void saveMedia({ path, chatName, filename: item.filename, ts: item.ts })
          }}
          className="absolute bottom-1 right-1 rounded-full bg-black/50 p-1.5 text-white opacity-0 transition group-hover:opacity-100"
        >
          <DownloadIcon className="h-4 w-4" />
        </button>
      </li>
    )
  }
  return (
    <li className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg bg-wa-raised p-2 text-center">
      <ImageIcon className="h-5 w-5 text-wa-muted" />
      {item.mediaId && !fetched ? (
        <button
          type="button"
          disabled={fetching}
          onClick={() => {
            if (!item.mediaId) return
            setFetching(true)
            setProblem(undefined)
            void fetchMedia(item.mediaId)
              .then(() => {
                setFetched(true)
              })
              .catch((e: unknown) => {
                setProblem(e instanceof Error ? e.message : String(e))
              })
              .finally(() => {
                setFetching(false)
              })
          }}
          className="text-[11px] font-medium text-wa-accent"
        >
          {fetching ? t('media.fetching') : t('media.fetch')}
        </button>
      ) : (
        <span className="text-[10px] text-wa-muted">{t('media.notFetched')}</span>
      )}
      {problem && <MediaProblemNote raw={problem} />}
    </li>
  )
}

function LinkItem({ text }: { text: string }): React.JSX.Element {
  const url = /https?:\/\/\S+/.exec(text)?.[0]
  if (!url) return <p className="text-[13px]">{text}</p>
  let host = url
  try {
    host = new URL(url).host
  } catch {
    // Not a URL after all; show it as written.
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 text-[13px] text-wa-accent hover:underline"
    >
      <LinkIcon className="h-4 w-4 shrink-0" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{host}</span>
        <span className="block truncate text-xs text-wa-muted">{url}</span>
      </span>
    </a>
  )
}
