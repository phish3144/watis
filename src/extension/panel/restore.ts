import { archive, importDatabaseFile, removeOpfs } from './api'
import { t } from './strings'
import { entryBlob, entryStream, readZipEntries, type ZipEntry } from './zip-reader'

/**
 * Putting a backup back into the browser's archive (ADR 0011).
 *
 * The way back from a removed extension, a reset browser profile, or a move from the hand-loaded
 * extension to a store install — each of which starts with an empty archive. It reads every backup
 * WatIs? writes, because they share one layout: `archive.sqlite`, `blobs/<aa>/<bb>/<sha256>.<ext>`,
 * `BACKUP.json`.
 *
 * - **A backup folder** (Chrome, Edge), including one the desktop app wrote.
 * - **ZIP backups** (every browser). Each ZIP after the first carries only the media that was new,
 *   so all of them are picked together: the media are their union, the database the newest one.
 *
 * Media go first and the database last, so the archive switches only once its files are there.
 * Media already here stay as they are — they are named by their content. The database **replaces**
 * the archive in this browser; the archive worker checks it before it does (archive-worker.ts),
 * and whatever WhatsApp Web holds right now is taken over again afterwards.
 */

/** A media file at its desktop-layout path. Nothing else from a backup is written anywhere. */
const BLOB_PATH = /^blobs\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}(\.[a-z0-9]{1,12})?$/
const IMPORT_PATH = 'imports/archive.sqlite'

export interface BackupReport {
  createdAt?: string
  variant?: string
  version?: string
}

interface BackupFile {
  path: string
  size: number
  open: () => Promise<ReadableStream<Uint8Array>>
}

export interface RestoreSource {
  /** When the backup was made, as well as it can be told. */
  createdAt: Date
  report: BackupReport | undefined
  database: BackupFile
  media: BackupFile[]
}

export interface RestoreProgress {
  files: number
  bytes: number
}

export interface RestoreResult {
  messages: number
  chats: number
  /** Media files written. */
  copied: number
  /** Media files that were here already. */
  kept: number
}

function parseReport(text: string): BackupReport | undefined {
  try {
    const value = JSON.parse(text) as unknown
    return typeof value === 'object' && value !== null ? value : undefined
  } catch {
    return undefined
  }
}

function dateOf(report: BackupReport | undefined, fallback: number): Date {
  const parsed = report?.createdAt ? Date.parse(report.createdAt) : NaN
  return new Date(Number.isNaN(parsed) ? fallback : parsed)
}

// --- sources -----------------------------------------------------------------------------------

type ReadPicker = (options: {
  id?: string
  mode?: 'read'
  startIn?: 'documents'
}) => Promise<FileSystemDirectoryHandle>

/** Asks for a backup folder. Must run from a click: the picker shows only for a user gesture. */
export async function sourceFromFolder(): Promise<RestoreSource> {
  const show = (window as unknown as { showDirectoryPicker?: ReadPicker }).showDirectoryPicker
  if (!show) throw new Error(t('backup.error.noFolderAccess'))
  const folder = await show({ id: 'watis-backup', mode: 'read', startIn: 'documents' })

  let database: File
  try {
    database = await (await folder.getFileHandle('archive.sqlite')).getFile()
  } catch {
    throw new Error(t('restore.error.noDatabase'))
  }
  let report: BackupReport | undefined
  try {
    report = parseReport(await (await (await folder.getFileHandle('BACKUP.json')).getFile()).text())
  } catch {
    report = undefined
  }

  const media: BackupFile[] = []
  let blobs: FileSystemDirectoryHandle | undefined
  try {
    blobs = await folder.getDirectoryHandle('blobs')
  } catch {
    blobs = undefined
  }
  if (blobs) {
    for await (const [a, level1] of blobs.entries()) {
      if (level1.kind !== 'directory') continue
      for await (const [b, level2] of level1.entries()) {
        if (level2.kind !== 'directory') continue
        for await (const [name, handle] of level2.entries()) {
          const path = `blobs/${a}/${b}/${name}`
          if (handle.kind !== 'file' || !BLOB_PATH.test(path)) continue
          const file = await handle.getFile()
          media.push({ path, size: file.size, open: () => Promise.resolve(file.stream()) })
        }
      }
    }
  }

  return {
    createdAt: dateOf(report, database.lastModified),
    report,
    database: {
      path: 'archive.sqlite',
      size: database.size,
      open: () => Promise.resolve(database.stream()),
    },
    media,
  }
}

/** Reads the ZIP backups somebody picked — all parts and all runs together. */
export async function sourceFromZips(files: readonly File[]): Promise<RestoreSource> {
  let newest: { at: Date; report: BackupReport | undefined; database: BackupFile } | undefined
  const media = new Map<string, BackupFile>()

  for (const file of files) {
    let entries: ZipEntry[]
    try {
      entries = await readZipEntries(file)
    } catch {
      throw new Error(t('restore.error.notZip', { name: file.name }))
    }
    const reportEntry = entries.find((e) => e.name === 'BACKUP.json')
    const report = reportEntry
      ? parseReport(await (await entryBlob(file, reportEntry)).text())
      : undefined
    const at = dateOf(report, file.lastModified)

    for (const entry of entries) {
      if (entry.name === 'archive.sqlite') {
        if (!newest || at > newest.at) {
          newest = {
            at,
            report,
            database: { path: entry.name, size: entry.size, open: () => entryStream(file, entry) },
          }
        }
      } else if (BLOB_PATH.test(entry.name) && !media.has(entry.name)) {
        media.set(entry.name, {
          path: entry.name,
          size: entry.size,
          open: () => entryStream(file, entry),
        })
      }
    }
  }

  if (!newest) throw new Error(t('restore.error.noDatabase'))
  return {
    createdAt: newest.at,
    report: newest.report,
    database: newest.database,
    media: [...media.values()],
  }
}

// --- restoring ---------------------------------------------------------------------------------

async function directory(path: string): Promise<FileSystemDirectoryHandle> {
  let dir = await navigator.storage.getDirectory()
  for (const part of path.split('/')) dir = await dir.getDirectoryHandle(part, { create: true })
  return dir
}

async function sizeIn(dir: FileSystemDirectoryHandle, name: string): Promise<number | undefined> {
  try {
    return (await (await dir.getFileHandle(name)).getFile()).size
  } catch {
    return undefined
  }
}

/** Streams a backup file into OPFS. The browser puts it in place only when it is complete. */
async function copyInto(dir: FileSystemDirectoryHandle, name: string, from: BackupFile) {
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable()
  await (await from.open()).pipeTo(writable)
}

/** The archive worker's reasons, in words somebody can act on. */
function explain(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/not a WatIs\? archive|not an SQLite database/.test(message)) {
    return new Error(t('restore.error.notArchive'))
  }
  if (message.includes('newer than this build')) return new Error(t('restore.error.newer'))
  return error instanceof Error ? error : new Error(message)
}

export async function restore(
  source: RestoreSource,
  onProgress: (progress: RestoreProgress) => void,
): Promise<RestoreResult> {
  const result = { copied: 0, kept: 0 }
  let bytes = 0
  const dirs = new Map<string, FileSystemDirectoryHandle>()

  for (const file of source.media) {
    const slash = file.path.lastIndexOf('/')
    const parent = file.path.slice(0, slash)
    const name = file.path.slice(slash + 1)
    const dir = dirs.get(parent) ?? (await directory(parent))
    dirs.set(parent, dir)
    if ((await sizeIn(dir, name)) === file.size) {
      result.kept++
    } else {
      await copyInto(dir, name, file)
      result.copied++
      bytes += file.size
    }
    onProgress({ files: result.copied + result.kept, bytes })
  }

  await copyInto(await directory('imports'), 'archive.sqlite', source.database)
  try {
    const counts = await importDatabaseFile(IMPORT_PATH).catch((error: unknown) => {
      throw explain(error)
    })
    return { messages: counts.messages, chats: counts.chats, ...result }
  } finally {
    await removeOpfs(IMPORT_PATH)
  }
}

/** How many messages the archive in this browser holds now — said before it is replaced. */
export async function currentMessages(): Promise<number | undefined> {
  try {
    return (await archive<{ messages: number }>({ op: 'stats' })).messages
  } catch {
    return undefined
  }
}
