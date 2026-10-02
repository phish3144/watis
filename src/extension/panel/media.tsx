import { useEffect, useRef, useState } from 'react'
import type { MediaRow } from '@shared/model/rows'
import { OpfsBlobStore } from '../host/opfs-blobs'
import { archive, blobUrl, fetchMedia, saveMedia } from './api'
import { bytes } from './format'
import { DownloadIcon, FileIcon, ImageIcon, MicIcon, VideoIcon } from './icons'
import { t } from './strings'
import { Spinner } from './ui'

/**
 * One attachment, in whatever state it is in: in the archive and shown, or not yet fetched and
 * one click away. Read from OPFS directly — the panel shares the extension's origin with the worker
 * that wrote the file, so there is no copy and no message round trip for the bytes.
 */

export function pathOf(media: Pick<MediaRow, 'sha256' | 'mime' | 'filename'>): string | null {
  return media.sha256 ? OpfsBlobStore.pathFor(media.sha256, media.mime, media.filename) : null
}

export function kindOf(mime: string | null | undefined): 'image' | 'video' | 'audio' | 'file' {
  const type = (mime ?? '').toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  return 'file'
}

/** Starts loading only when scrolled into view, so a long chat does not read every file at once. */
function useVisible<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element || visible) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setVisible(true)
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [visible])
  return [ref, visible]
}

export function useBlobUrl(path: string | null, enabled = true): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!path || !enabled) return
    let alive = true
    blobUrl(path).then(
      (value) => {
        if (alive) setUrl(value)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [path, enabled])
  return url
}

export function Attachment({
  mediaId,
  chatName,
  ts,
}: {
  mediaId: string
  chatName: string
  ts: number
}): React.JSX.Element {
  const [ref, visible] = useVisible<HTMLDivElement>()
  const [media, setMedia] = useState<MediaRow | null | undefined>(undefined)
  const [fetching, setFetching] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)

  const reload = (): Promise<void> =>
    archive<{ media: MediaRow | null }>({ op: 'media', mediaId }).then((r) => {
      setMedia(r.media)
    })

  useEffect(() => {
    if (visible) void reload().catch(() => undefined)
  }, [visible, mediaId])

  const path = media ? pathOf(media) : null
  const url = useBlobUrl(path, visible)
  const kind = kindOf(media?.mime)

  const fetchNow = (): void => {
    setFetching(true)
    setError(undefined)
    fetchMedia(mediaId)
      .then(reload)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        setFetching(false)
      })
  }

  const save = (): void => {
    if (path) void saveMedia({ path, chatName, filename: media?.filename ?? null, ts })
  }

  if (url && kind === 'image') {
    return (
      <div ref={ref}>
        <button type="button" onClick={save} title={t('media.save')} className="block">
          <img
            src={url}
            alt={media?.filename ?? ''}
            className="max-h-64 w-full rounded-lg object-cover"
            loading="lazy"
          />
        </button>
      </div>
    )
  }
  if (url && kind === 'audio') {
    return (
      <div ref={ref}>
        <audio src={url} controls className="w-full" preload="metadata" />
      </div>
    )
  }
  if (url && kind === 'video') {
    return (
      <div ref={ref}>
        <video src={url} controls className="max-h-64 w-full rounded-lg" preload="metadata" />
      </div>
    )
  }

  const Icon = { image: ImageIcon, video: VideoIcon, audio: MicIcon, file: FileIcon }[kind]
  const label = media?.filename ?? t(`chat.attachment.${kind}`)
  return (
    <div ref={ref} className="flex items-center gap-2.5 rounded-xl bg-wa-raised/70 px-3 py-2">
      <Icon className="h-5 w-5 shrink-0 text-wa-muted" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">{label}</div>
        <div className="text-[11px] text-wa-muted">
          {[bytes(media?.size), path ? undefined : t('media.notFetched')]
            .filter(Boolean)
            .join(' · ')}
          {error && <span className="text-wa-danger"> · {error}</span>}
        </div>
      </div>
      {path ? (
        <button
          type="button"
          onClick={save}
          aria-label={t('media.save')}
          title={t('media.save')}
          className="text-wa-accent"
        >
          <DownloadIcon className="h-5 w-5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={fetchNow}
          disabled={fetching || media === undefined}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-wa-accent hover:bg-wa-accent-soft disabled:opacity-60"
        >
          {fetching ? <Spinner /> : null}
          {fetching ? t('media.fetching') : t('media.fetch')}
        </button>
      )}
    </div>
  )
}
