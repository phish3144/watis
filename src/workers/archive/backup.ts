import { copyFile, link, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArchiveRepository } from './repository'
import { extensionFor, shardPath, type BlobStore } from './blob-store'
import {
  newestTs,
  readExportState,
  writeExport,
  writeExportState,
  type ExportFormat,
} from './export-writer'
import { buildIntegrityReport } from './export'
import { sanitiseFilename } from '../../main/downloads/filename'

/**
 * Export and backup, run inside the archive worker (PLAN.md Phase 6).
 *
 * They are two different things and the difference matters. An **export** is for people: readable
 * files in per-chat folders that outlive this application. A **backup** is for machines: the
 * database and the blobs, restorable by copying them back.
 *
 * Neither may run in main — both walk the database and the disk, and main is not allowed to do
 * either (§5.6).
 */

const PAGE = 1000

export interface ExportRunResult {
  chats: number
  messages: number
  files: string[]
  mediaMissing: string[]
  skipped: number
}

export async function runExport(
  repo: ArchiveRepository,
  blobs: BlobStore,
  request: {
    targetDir: string
    formats: readonly ExportFormat[]
    incremental: boolean
    chatIds?: readonly string[] | undefined
  },
): Promise<ExportRunResult> {
  await mkdir(request.targetDir, { recursive: true })
  const stateFile = join(request.targetDir, '.watis-export-state.json')
  const state = request.incremental
    ? await readExportState(stateFile)
    : { lastTsByChat: {} as Record<string, number> }

  const chatIds = request.chatIds ?? repo.chats(1000).map((c) => c.id)
  const result: ExportRunResult = {
    chats: 0,
    messages: 0,
    files: [],
    mediaMissing: [],
    skipped: 0,
  }

  for (const chatId of chatIds) {
    const since = state.lastTsByChat[chatId]
    let afterId: string | undefined
    let wroteAnything = false

    // Paged rather than loaded whole: a chat with a million messages must not become a million-row
    // array in memory just because somebody pressed export.
    for (;;) {
      const page = repo.chatForExport(chatId, { since, limit: PAGE, afterId })
      if (!page.chat || page.messages.length === 0) break

      const written = await writeExport({
        chat: { chat: page.chat, messages: page.messages },
        targetDir: request.targetDir,
        formats: request.formats,
        blobPathFor: (mediaId) => {
          const media = page.messages.find((m) => m.media?.id === mediaId)?.media
          if (!media?.sha256) return undefined
          return blobs.pathFor(media.sha256, media.mime, media.filename)
        },
      })

      result.messages += written.messages
      result.mediaMissing.push(...written.mediaMissing)
      for (const file of written.files) if (!result.files.includes(file)) result.files.push(file)
      wroteAnything = true

      const last = page.messages[page.messages.length - 1]
      const newest = newestTs({ chat: page.chat, messages: page.messages })
      if (newest !== undefined) state.lastTsByChat[chatId] = newest
      if (page.messages.length < PAGE || !last) break
      afterId = last.id
    }

    if (wroteAnything) result.chats++
    else result.skipped++
  }

  if (request.incremental) await writeExportState(stateFile, state)
  return result
}

export interface BackupResult {
  databaseFile: string
  blobsCopied: number
  blobsMissing: number
  bytes: number
}

/**
 * A backup that can actually be restored: the database as a single consistent file, and every blob
 * it references beside it.
 *
 * A database without its blobs restores to an archive full of dead links, which is exactly the kind
 * of backup people discover is useless at the worst moment. Blobs are hardlinked where the target
 * is on the same filesystem and copied otherwise — a backup that fails is worse than one that takes
 * longer.
 */
export async function runBackup(
  repo: ArchiveRepository,
  blobs: BlobStore,
  request: { targetDir: string; includeBlobs: boolean },
): Promise<BackupResult> {
  await mkdir(request.targetDir, { recursive: true })
  const databaseFile = join(request.targetDir, 'archive.sqlite')

  // VACUUM INTO refuses to overwrite, so a previous run is cleared first. That is safe: a backup
  // half-written over its predecessor would be worthless either way, and the copy is atomic from
  // SQLite's side.
  await rm(databaseFile, { force: true })
  repo.snapshot(databaseFile)

  const result: BackupResult = {
    databaseFile,
    blobsCopied: 0,
    blobsMissing: 0,
    bytes: repo.stats().databaseBytes,
  }

  const media = repo.mediaForBackup()
  const carried = new Set<string>()

  if (request.includeBlobs) {
    const blobDir = join(request.targetDir, 'blobs')
    const seen = new Set<string>()
    for (const row of media) {
      if (!row.sha256 || seen.has(row.sha256)) continue
      seen.add(row.sha256)

      const source = blobs.pathFor(row.sha256, row.mime, row.filename)
      const target = join(blobDir, shardPath(row.sha256, extensionFor(row.mime, row.filename)))
      await mkdir(join(target, '..'), { recursive: true })
      try {
        await link(source, target)
        carried.add(row.sha256)
        result.blobsCopied++
      } catch {
        try {
          await copyFile(source, target)
          carried.add(row.sha256)
          result.blobsCopied++
        } catch {
          // Recorded rather than thrown: one missing blob must not cost the whole backup.
          result.blobsMissing++
        }
      }
    }
  }

  // The report names what is in the backup and what is not, so a restore is not a guessing game.
  // It is built from the rows that were actually attempted, not from a count of exceptions.
  const stats = repo.stats()
  const report = buildIntegrityReport({
    chats: stats.chats,
    messages: stats.messages,
    media,
    blobExists: (row) =>
      request.includeBlobs ? Boolean(row.sha256 && carried.has(row.sha256)) : true,
  })
  await writeFile(
    join(request.targetDir, 'BACKUP.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), ...result, report }, null, 2),
    'utf8',
  )

  return result
}

export interface SaveMediaResult {
  saved: number
  missing: number
  files: string[]
}

/**
 * Copies a set of archived media into a folder the user chose (PLAN.md Phase 2).
 *
 * Hardlink first, copy as a fallback — the same rule the export uses: a save that fails is worse
 * than one that takes longer. A blob that is not on disk is counted, not thrown: saving nine of
 * ten files and saying so beats saving none.
 */
export async function saveMedia(
  repo: ArchiveRepository,
  blobs: BlobStore,
  request: { mediaIds: readonly string[]; targetDir: string },
): Promise<SaveMediaResult> {
  await mkdir(request.targetDir, { recursive: true })
  const result: SaveMediaResult = { saved: 0, missing: 0, files: [] }
  const used = new Set<string>()

  for (const id of request.mediaIds) {
    const row = repo.mediaById(id)
    if (!row?.sha256) {
      result.missing++
      continue
    }

    const source = blobs.pathFor(row.sha256, row.mime, row.filename)
    // sanitiseFilename, not sanitiseComponent: the latter is for directory names and treats the
    // whole string as a stem, so it eats the extension. `extensionFor` returns the bare extension
    // without a dot — the blob store's own paths add it — so a fallback name puts it back.
    const name = uniqueName(
      sanitiseFilename(
        row.filename ?? `${row.sha256.slice(0, 12)}.${extensionFor(row.mime, row.filename)}`,
        { fallback: 'Datei' },
      ),
      used,
    )
    const target = join(request.targetDir, name)

    try {
      await link(source, target)
    } catch {
      try {
        await copyFile(source, target)
      } catch {
        result.missing++
        continue
      }
    }
    result.saved++
    result.files.push(target)
  }

  return result
}

/**
 * Two photos from different chats can genuinely have the same name, so a collision is numbered
 * rather than silently overwritten — losing one of them would be the worse outcome.
 */
function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name)
    return name
  }
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${String(n)})${extension}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
}
