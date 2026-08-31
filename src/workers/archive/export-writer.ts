import { link, mkdir, readFile, writeFile } from 'node:fs/promises'
import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { sanitiseComponent, sanitiseFilename } from '../../main/downloads/filename'
import { toHtml, toJson, toText, type ExportChat } from './export'

/**
 * Writing an export to disk (PLAN.md Phase 6).
 *
 * The blob store is content-addressed and therefore unreadable to a person; an export has to
 * materialise chat folders with human names. Media is hard-linked where the filesystem allows it, so
 * exporting a 20 GB archive costs directory entries rather than 20 GB — and falls back to copying
 * when it cannot, because a failed export is worse than a slow one.
 */

export type ExportFormat = 'json' | 'html' | 'txt'

export interface ExportRequest {
  chat: ExportChat
  /** Directory to write into; created if missing. */
  targetDir: string
  formats: readonly ExportFormat[]
  /** Resolves a media row to its blob on disk. */
  blobPathFor(mediaId: string): string | undefined
  /** Only export messages newer than this — the incremental run. */
  since?: number | undefined
}

export interface ExportResult {
  files: string[]
  mediaLinked: number
  mediaCopied: number
  mediaMissing: string[]
  messages: number
}

const EXTENSION: Record<ExportFormat, string> = { json: 'json', html: 'html', txt: 'txt' }

export async function writeExport(request: ExportRequest): Promise<ExportResult> {
  const name = sanitiseComponent(request.chat.chat.name ?? request.chat.chat.id, {
    fallback: 'Unsortiert',
  })
  const chatDir = join(request.targetDir, name)
  const mediaDir = join(chatDir, 'media')
  await mkdir(mediaDir, { recursive: true })

  const since = request.since
  const messages =
    since === undefined ? request.chat.messages : request.chat.messages.filter((m) => m.ts > since)
  const chat: ExportChat = { chat: request.chat.chat, messages }

  const result: ExportResult = {
    files: [],
    mediaLinked: 0,
    mediaCopied: 0,
    mediaMissing: [],
    messages: messages.length,
  }

  for (const format of request.formats) {
    const body = format === 'json' ? toJson(chat) : format === 'html' ? toHtml(chat) : toText(chat)
    const file = join(chatDir, `${name}.${EXTENSION[format]}`)
    await writeFile(file, body, 'utf8')
    result.files.push(file)
  }

  for (const message of messages) {
    const media = message.media
    if (!media) continue
    const source = request.blobPathFor(media.id)
    if (source === undefined) {
      result.mediaMissing.push(media.id)
      continue
    }
    const target = join(
      mediaDir,
      sanitiseFilename(media.filename ?? media.id, { fallback: media.id }),
    )
    try {
      await link(source, target)
      result.mediaLinked++
    } catch {
      // Different filesystem, or a platform that refuses the link. Copying is slower but an export
      // that fails is worse than one that takes longer.
      try {
        await copyFile(source, target)
        result.mediaCopied++
      } catch {
        result.mediaMissing.push(media.id)
      }
    }
  }

  return result
}

export interface ExportState {
  /** Newest message timestamp exported per chat, so the next run only adds what is new. */
  lastTsByChat: Record<string, number>
}

export async function readExportState(file: string): Promise<ExportState> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as ExportState
  } catch {
    // No state is not an error: it means this is the first run.
    return { lastTsByChat: {} }
  }
}

export async function writeExportState(file: string, state: ExportState): Promise<void> {
  await writeFile(file, JSON.stringify(state, null, 2), 'utf8')
}

/** The newest timestamp in a batch, for recording after a successful run. */
export function newestTs(chat: ExportChat): number | undefined {
  const times = chat.messages.map((m) => m.ts)
  return times.length > 0 ? Math.max(...times) : undefined
}
