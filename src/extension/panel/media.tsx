import { useEffect, useRef, useState } from 'react'
import type { MediaRow } from '@shared/model/rows'
import { OpfsBlobStore } from '../host/opfs-blobs'
import { archive, blobUrl, fetchMedia, saveMedia } from './api'
import { bytes } from './format'
import { DownloadIcon, FileIcon, ImageIcon, MicIcon, VideoIcon } from './icons'
import { HelpLink } from './helpui'
import { explainMediaProblem } from './problems'
import { t } from './strings'
import {
  downloadModel,
  FIRST_MODEL,
  MODELS,
  modelReady,
  transcribe,
  transcriptionSupported,
} from './transcribe'
import { Button, Spinner } from './ui'

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
  // A voice message keeps one layout while it changes state: the player once it is here, the card
  // with "Laden" until then, and the transcript below either way. The transcript stays mounted when
  // the file arrives, so a transcription that fetched it does not lose its progress on the way.
  if (kind === 'audio') {
    const fetchForTranscript = (): Promise<string> =>
      fetchMedia(mediaId)
        .then(() => archive<{ media: MediaRow | null }>({ op: 'media', mediaId }))
        .then((r) => {
          setMedia(r.media)
          const fetched = r.media ? pathOf(r.media) : null
          if (!fetched) throw new Error('WhatsApp did not hand over the file')
          return fetched
        })
    return (
      <div ref={ref} className="space-y-1.5">
        {url && path ? (
          <audio src={url} controls className="w-full" preload="metadata" />
        ) : (
          <AttachmentCard
            kind={kind}
            label={media?.filename ?? t('chat.attachment.audio')}
            size={media?.size}
            path={path}
            error={error}
            fetching={fetching}
            canFetch={media !== undefined}
            onFetch={fetchNow}
            onSave={save}
          />
        )}
        {transcriptionSupported() && media !== undefined && (
          <Transcript mediaId={mediaId} path={path} fetchAudio={fetchForTranscript} />
        )}
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

  return (
    <div ref={ref}>
      <AttachmentCard
        kind={kind}
        label={media?.filename ?? t(`chat.attachment.${kind}`)}
        size={media?.size}
        path={path}
        error={error}
        fetching={fetching}
        canFetch={media !== undefined}
        onFetch={fetchNow}
        onSave={save}
      />
    </div>
  )
}

/** A file that is not shown inline: its name and size, and the one action that applies to it. */
function AttachmentCard({
  kind,
  label,
  size,
  path,
  error,
  fetching,
  canFetch,
  onFetch,
  onSave,
}: {
  kind: 'image' | 'video' | 'audio' | 'file'
  label: string
  size: number | null | undefined
  path: string | null
  error: string | undefined
  fetching: boolean
  canFetch: boolean
  onFetch: () => void
  onSave: () => void
}): React.JSX.Element {
  const Icon = { image: ImageIcon, video: VideoIcon, audio: MicIcon, file: FileIcon }[kind]
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-wa-raised/70 px-3 py-2">
      <Icon className="h-5 w-5 shrink-0 text-wa-muted" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">{label}</div>
        <div className="text-[11px] text-wa-muted">
          {[bytes(size), path ? undefined : t('media.notFetched')].filter(Boolean).join(' · ')}
        </div>
        {error && <MediaProblemNote raw={error} />}
      </div>
      {path ? (
        <button
          type="button"
          onClick={onSave}
          aria-label={t('media.save')}
          title={t('media.save')}
          className="text-wa-accent"
        >
          <DownloadIcon className="h-5 w-5" />
        </button>
      ) : (
        <button
          type="button"
          onClick={onFetch}
          disabled={fetching || !canFetch}
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
 * What was said in a voice message: the stored transcript, or one button that gets it — whatever
 * that takes. The first time there is no speech model yet; the button then says what it would
 * download and how large it is, and the download starts only on the next click (CLAUDE.md: model
 * downloads only after an explicit action). A voice message that is not in the archive yet is
 * fetched on the way. The text goes into the archive, so the search finds it from then on
 * (`source:transcript`).
 */
type Step =
  | { kind: 'idle' }
  | { kind: 'offer' }
  | { kind: 'model'; percent: number }
  | { kind: 'fetch' }
  | { kind: 'transcribe'; percent: number }

function Transcript({
  mediaId,
  path,
  fetchAudio,
}: {
  mediaId: string
  path: string | null
  fetchAudio: () => Promise<string>
}): React.JSX.Element | null {
  const [text, setText] = useState<string | null | undefined>(undefined)
  const [hasModel, setHasModel] = useState<boolean | undefined>(undefined)
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [error, setError] = useState<{ message: string; fetching: boolean } | undefined>(undefined)

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
    void modelReady().then((ready) => {
      if (alive) setHasModel(ready)
    })
    return () => {
      alive = false
    }
  }, [mediaId])

  const run = (download: boolean): void => {
    setError(undefined)
    let fetching = false
    // The download starts inside the click itself: a browser grants the permission to reach
    // GitHub only during the gesture that asked for it.
    const model = download
      ? downloadModel(FIRST_MODEL, (fraction) => {
          setStep({ kind: 'model', percent: Math.round(fraction * 100) })
        })
      : Promise.resolve()
    setStep(download ? { kind: 'model', percent: 0 } : { kind: 'transcribe', percent: 0 })
    model
      .then(async () => {
        setHasModel(true)
        let audio = path
        if (!audio) {
          fetching = true
          setStep({ kind: 'fetch' })
          audio = await fetchAudio()
          fetching = false
        }
        setStep({ kind: 'transcribe', percent: 0 })
        return transcribe(mediaId, audio, (percent) => {
          setStep({ kind: 'transcribe', percent })
        })
      })
      .then(setText)
      .catch((e: unknown) => {
        setError({ message: e instanceof Error ? e.message : String(e), fetching })
      })
      .finally(() => {
        setStep({ kind: 'idle' })
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
  if (text === undefined || hasModel === undefined) return null

  if (step.kind === 'offer') {
    return (
      <div className="space-y-2 rounded-xl bg-wa-accent-soft px-3 py-2 text-[12px] leading-snug">
        <p>
          {t('transcription.offer', { size: bytes(MODELS[FIRST_MODEL].bytes) })}{' '}
          <HelpLink topic="sprachnachrichten" />
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            onClick={() => {
              run(true)
            }}
          >
            {t('transcription.offer.go')}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setStep({ kind: 'idle' })
            }}
          >
            {t('transcription.offer.cancel')}
          </Button>
        </div>
      </div>
    )
  }

  const busy = step.kind !== 'idle'
  const label =
    step.kind === 'model'
      ? t('transcription.downloading', { percent: step.percent })
      : step.kind === 'fetch'
        ? t('media.fetching')
        : step.kind === 'transcribe'
          ? // A short message is one segment: whisper.cpp reports 0 and then 100, nothing between.
            step.percent > 0
            ? t('media.transcribing.percent', { percent: Math.round(step.percent) })
            : t('media.transcribing')
          : t('media.transcribe')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => {
          if (hasModel) run(false)
          else setStep({ kind: 'offer' })
        }}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-wa-accent hover:bg-wa-accent-soft disabled:opacity-60"
      >
        {busy ? <Spinner /> : <MicIcon className="h-4 w-4" />}
        {label}
      </button>
      {error &&
        (error.fetching ? (
          <MediaProblemNote raw={error.message} />
        ) : (
          <span className="text-[11px] text-wa-danger">
            {error.message} <HelpLink topic="sprachnachrichten" />
          </span>
        ))}
    </div>
  )
}

/**
 * Why a file did not come, said so somebody can act on it (problems.ts): what happened, what to do,
 * and the way to the help. The reason as it came stays available as a tooltip for a bug report.
 */
export function MediaProblemNote({ raw }: { raw: string }): React.JSX.Element {
  const problem = explainMediaProblem(raw)
  return (
    <p
      className="mt-0.5 text-[11px] leading-snug text-wa-danger"
      title={t('media.problem.details', { raw: problem.raw })}
    >
      {problem.text}
      {problem.advice && <span className="text-wa-muted"> {problem.advice}</span>}
      {!problem.known && <span className="text-wa-muted"> ({problem.raw})</span>}{' '}
      <HelpLink topic={problem.help} />
    </p>
  )
}
