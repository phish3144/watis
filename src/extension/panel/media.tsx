import { useEffect, useRef, useState } from 'react'
import type { MediaRow } from '@shared/model/rows'
import { OpfsBlobStore } from '../host/opfs-blobs'
import { archive, blobUrl, fetchMedia, saveMedia } from './api'
import { bytes } from './format'
import { DownloadIcon, FileIcon, ImageIcon, MicIcon, VideoIcon } from './icons'
import { t } from './strings'
import { transcribe, transcriptionSupported } from './transcribe'
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
  if (url && kind === 'audio' && path) {
    return (
      <div ref={ref} className="space-y-1.5">
        <audio src={url} controls className="w-full" preload="metadata" />
        <Transcript mediaId={mediaId} path={path} />
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

/**
 * What was said in a voice message: the stored transcript, or the button that makes one. The text
 * goes into the archive, so the search finds it from then on (`source:transcript`).
 */
function Transcript({
  mediaId,
  path,
}: {
  mediaId: string
  path: string
}): React.JSX.Element | null {
  const [text, setText] = useState<string | null | undefined>(undefined)
  const [percent, setPercent] = useState<number | undefined>(undefined)
  const [error, setError] = useState<string | undefined>(undefined)

  useEffect(() => {
    let alive = true
    archive<{ transcript: { text: string } | null }>({ op: 'transcript', mediaId }).then(
      (r) => {
        if (alive) setText(r.transcript?.text ?? null)
      },
      () => {
        if (alive) setText(null)
      },
    )
    return () => {
      alive = false
    }
  }, [mediaId])

  const start = (): void => {
    setError(undefined)
    setPercent(0)
    transcribe(mediaId, path, setPercent)
      .then(setText)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        setPercent(undefined)
      })
  }

  if (text !== undefined && text !== null) {
    return (
      <figure className="rounded-xl bg-wa-raised/70 px-3 py-2">
        <figcaption className="text-[11px] font-medium text-wa-muted">
          {t('media.transcript')}
        </figcaption>
        <p className="mt-0.5 whitespace-pre-line text-[13px] leading-snug">
          {text === '' ? t('media.transcript.empty') : text}
        </p>
      </figure>
    )
  }
  if (text === undefined || !transcriptionSupported()) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={start}
        disabled={percent !== undefined}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-wa-accent hover:bg-wa-accent-soft disabled:opacity-60"
      >
        {percent !== undefined ? <Spinner /> : <MicIcon className="h-4 w-4" />}
        {percent === undefined
          ? t('media.transcribe')
          : // A short message is one segment: whisper.cpp reports 0 and then 100, nothing between.
            percent > 0
            ? t('media.transcribing.percent', { percent: Math.round(percent) })
            : t('media.transcribing')}
      </button>
      {error && <span className="text-[11px] text-wa-danger">{error}</span>}
    </div>
  )
}
