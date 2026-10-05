import { dateStamp } from '@shared/files/sanitise'
import { ext } from '../ext'
import { exportDatabaseFile, removeOpfs, version } from './api'
import { t } from './strings'
import { ZIP_ENTRY_LIMIT, ZIP_PART_LIMIT, ZipWriter } from './zip'

/**
 * Getting the archive out of the browser (ADR 0011).
 *
 * The archive lives in the extension's OPFS. That survives WhatsApp logging out, the browser's
 * cache being cleared and the extension being updated — but not the extension being removed, nor a
 * company resetting the browser profile. A copy in a real folder is what makes it permanent, and
 * it is the user's folder, not a cloud of ours: a folder OneDrive or Nextcloud syncs is as good a
 * choice as a USB stick, and that choice stays theirs (CLAUDE.md, "Datenschutz und Netz").
 *
 * Both ways write the desktop's backup layout — `archive.sqlite`, `blobs/<aa>/<bb>/<sha256>.<ext>`,
 * `BACKUP.json` — so a backup taken in the browser is a backup the desktop app understands too.
 *
 * - **Folder** (Chrome, Edge): mirrored into a folder picked once. Content-addressed files that are
 *   already there are not written again, so every run after the first copies only what is new.
 * - **ZIP** (every browser — Firefox has no folder access): downloads holding the database and the
 *   media stored since the last ZIP, in parts of at most a gigabyte. Each part is built in OPFS and
 *   removed once downloaded, so a backup never needs twice the archive's space.
 */

const STATE_KEY = 'watis:backup'

export interface BackupState {
  folder?: { at: number; name: string; files: number }
  zip?: { at: number; files: number }
}

export interface BackupProgress {
  /** Media files looked at so far. */
  files: number
  /** Bytes written so far. */
  bytes: number
}

export interface BackupResult {
  /** Media files written. */
  copied: number
  /** Media files that were already in the backup. */
  kept: number
  /** For a ZIP backup: the downloads, as named in the downloads folder. */
  parts: string[]
}

export async function backupState(): Promise<BackupState> {
  const stored = await ext.storage.local.get(STATE_KEY)
  return (stored[STATE_KEY] as BackupState | undefined) ?? {}
}

async function saveState(patch: BackupState): Promise<void> {
  await ext.storage.local.set({ [STATE_KEY]: { ...(await backupState()), ...patch } })
}

/** Every stored media file, walking the shards one directory at a time. */
async function* storedBlobs(): AsyncGenerator<{ path: string; file: File }> {
  let blobs: FileSystemDirectoryHandle
  try {
    blobs = await (await navigator.storage.getDirectory()).getDirectoryHandle('blobs')
  } catch {
    return
  }
  for await (const [a, level1] of blobs.entries()) {
    if (level1.kind !== 'directory') continue
    for await (const [b, level2] of level1.entries()) {
      if (level2.kind !== 'directory') continue
      for await (const [name, handle] of level2.entries()) {
        // A `.part` is a download in progress; it gets its real name when it is complete.
        if (handle.kind !== 'file' || name.endsWith('.part')) continue
        try {
          yield { path: `blobs/${a}/${b}/${name}`, file: await handle.getFile() }
        } catch {
          // Being written right now; the next backup takes it.
        }
      }
    }
  }
}

function report(kind: 'folder' | 'zip', media: number, since?: number): Blob {
  return new Blob(
    [
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          app: 'WatIs?',
          variant: 'browser',
          version,
          kind,
          database: 'archive.sqlite',
          media,
          ...(since ? { mediaSince: new Date(since).toISOString() } : {}),
          restore:
            'archive.sqlite und blobs/ haben dasselbe Format wie die Sicherung der Desktop-App.',
        },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  )
}

// --- folder ------------------------------------------------------------------------------------

/** The parts of the File System Access API this uses; lib.dom does not declare them yet. */
interface PermissionedHandle extends FileSystemDirectoryHandle {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>
}
type DirectoryPicker = (options: {
  id?: string
  mode?: 'readwrite'
  startIn?: 'documents'
}) => Promise<FileSystemDirectoryHandle>

function picker(): DirectoryPicker | undefined {
  return (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker
}

/** Whether this browser lets an extension write into a folder (Chrome and Edge do). */
export function folderBackupSupported(): boolean {
  return typeof picker() === 'function'
}

/** The chosen folder is kept in IndexedDB: a folder handle survives there, and nowhere else. */
function handleStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('watis-backup', 1)
    open.onupgradeneeded = () => {
      open.result.createObjectStore('handles')
    }
    open.onerror = () => {
      reject(open.error ?? new Error('IndexedDB'))
    }
    open.onsuccess = () => {
      const db = open.result
      const request = run(db.transaction('handles', mode).objectStore('handles'))
      request.onsuccess = () => {
        resolve(request.result as T)
        db.close()
      }
      request.onerror = () => {
        reject(request.error ?? new Error('IndexedDB'))
        db.close()
      }
    }
  })
}

export async function savedFolder(): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return await handleStore<FileSystemDirectoryHandle | undefined>('readonly', (s) =>
      s.get('folder'),
    )
  } catch {
    return undefined
  }
}

/** Asks for a folder. Must run from a click: browsers show the picker only for a user gesture. */
export async function chooseFolder(): Promise<string> {
  const show = picker()
  if (!show) throw new Error(t('backup.error.noFolderAccess'))
  const handle = await show({ id: 'watis-backup', mode: 'readwrite', startIn: 'documents' })
  await handleStore('readwrite', (s) => s.put(handle, 'folder'))
  return handle.name
}

async function writeInto(dir: FileSystemDirectoryHandle, name: string, data: Blob): Promise<void> {
  // The browser writes to a swap file and puts it in place on close: an interrupted run leaves
  // the previous file, never half of a new one.
  const writable = await (await dir.getFileHandle(name, { create: true })).createWritable()
  await data.stream().pipeTo(writable)
}

async function sizeIn(dir: FileSystemDirectoryHandle, name: string): Promise<number | undefined> {
  try {
    return (await (await dir.getFileHandle(name)).getFile()).size
  } catch {
    return undefined
  }
}

/** Mirrors the archive into the chosen folder. Call it from a click: it may have to ask again. */
export async function backupToFolder(
  onProgress: (progress: BackupProgress) => void,
): Promise<BackupResult> {
  const folder = (await savedFolder()) as PermissionedHandle | undefined
  if (!folder) throw new Error(t('backup.error.noFolder'))
  // The browser forgets the permission when it restarts; asking again is one click for the user.
  if (
    (await folder.queryPermission({ mode: 'readwrite' })) !== 'granted' &&
    (await folder.requestPermission({ mode: 'readwrite' })) !== 'granted'
  ) {
    throw new Error(t('backup.error.permission'))
  }

  // The database first: it is the part that matters most, and the smallest.
  const database = await exportDatabaseFile()
  try {
    await writeInto(folder, 'archive.sqlite', database.file)
  } finally {
    await removeOpfs(database.path)
  }

  const dirs = new Map<string, FileSystemDirectoryHandle>()
  const dirFor = async (path: string): Promise<FileSystemDirectoryHandle> => {
    const cached = dirs.get(path)
    if (cached) return cached
    let dir: FileSystemDirectoryHandle = folder
    for (const part of path.split('/')) dir = await dir.getDirectoryHandle(part, { create: true })
    dirs.set(path, dir)
    return dir
  }

  const result: BackupResult = { copied: 0, kept: 0, parts: [] }
  let bytes = 0
  for await (const blob of storedBlobs()) {
    const slash = blob.path.lastIndexOf('/')
    const dir = await dirFor(blob.path.slice(0, slash))
    const name = blob.path.slice(slash + 1)
    // Named by content: the same name and size is the same file.
    if ((await sizeIn(dir, name)) === blob.file.size) {
      result.kept++
    } else {
      await writeInto(dir, name, blob.file)
      result.copied++
      bytes += blob.file.size
    }
    onProgress({ files: result.copied + result.kept, bytes })
  }

  await writeInto(folder, 'BACKUP.json', report('folder', result.copied + result.kept))
  await saveState({
    folder: { at: Date.now(), name: folder.name, files: result.copied + result.kept },
  })
  return result
}

// --- ZIP ---------------------------------------------------------------------------------------

const TEMP_DIR = 'backup-parts'

async function tempDir(): Promise<FileSystemDirectoryHandle> {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(TEMP_DIR, { create: true })
}

/** Parts a closed panel left behind. */
async function clearTemp(): Promise<void> {
  const dir = await tempDir()
  const names: string[] = []
  for await (const name of dir.keys()) names.push(name)
  for (const name of names) await dir.removeEntry(name).catch(() => undefined)
}

/** Hands a file to the browser's downloads and waits until it is written. */
async function download(file: File, filename: string): Promise<void> {
  const url = URL.createObjectURL(file)
  try {
    const id = await ext.downloads.download({
      url,
      filename,
      saveAs: false,
      conflictAction: 'uniquify',
    })
    await new Promise<void>((resolve, reject) => {
      const settle = (state: string | undefined, error?: string): void => {
        if (state === 'complete') {
          ext.downloads.onChanged.removeListener(listener)
          resolve()
        } else if (state === 'interrupted') {
          ext.downloads.onChanged.removeListener(listener)
          reject(new Error(t('backup.error.download', { error: error ?? '?' })))
        }
      }
      const listener = (delta: chrome.downloads.DownloadDelta): void => {
        if (delta.id === id) settle(delta.state?.current, delta.error?.current)
      }
      ext.downloads.onChanged.addListener(listener)
      // It may have finished before the listener was there.
      void ext.downloads.search({ id }).then(([item]) => {
        settle(item?.state, item?.error)
      })
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

interface Part {
  name: string
  writer: ZipWriter
  writable: FileSystemWritableFileStream
}

/**
 * Downloads the database and the media stored since the last ZIP backup — or all media, with
 * `full`. Nothing is marked as backed up until every part is in the downloads folder.
 */
export async function backupAsZip(
  onProgress: (progress: BackupProgress) => void,
  { full = false }: { full?: boolean } = {},
): Promise<BackupResult> {
  const started = Date.now()
  const since = full ? 0 : ((await backupState()).zip?.at ?? 0)
  const base = `watis-sicherung-${dateStamp(new Date(started))}`
  const dir = await tempDir()
  await clearTemp()

  const result: BackupResult = { copied: 0, kept: 0, parts: [] }
  let bytes = 0

  const open = async (): Promise<Part> => {
    const number = result.parts.length + 1
    const name = number === 1 ? `${base}.zip` : `${base}-teil${String(number)}.zip`
    const writable = await (await dir.getFileHandle(name, { create: true })).createWritable()
    const writer = new ZipWriter(async (data, position) => {
      await writable.write({ type: 'write', position, data: data as Uint8Array<ArrayBuffer> })
    })
    return { name, writer, writable }
  }
  const close = async (part: Part): Promise<void> => {
    await part.writer.finish()
    await part.writable.close()
    const target = `WatIs/Sicherung/${part.name}`
    try {
      await download(await (await dir.getFileHandle(part.name)).getFile(), target)
    } finally {
      await dir.removeEntry(part.name).catch(() => undefined)
    }
    result.parts.push(target)
  }

  let part = await open()
  const database = await exportDatabaseFile()
  try {
    await part.writer.add('archive.sqlite', database.file)
  } finally {
    await removeOpfs(database.path)
  }

  for await (const blob of storedBlobs()) {
    if (blob.file.lastModified <= since) {
      result.kept++
      continue
    }
    const tooBig = part.writer.size + blob.file.size > ZIP_PART_LIMIT
    if ((tooBig && part.writer.count > 0) || part.writer.count >= ZIP_ENTRY_LIMIT) {
      await close(part)
      part = await open()
    }
    await part.writer.add(blob.path, blob.file, new Date(blob.file.lastModified))
    result.copied++
    bytes += blob.file.size
    onProgress({ files: result.copied + result.kept, bytes })
  }

  await part.writer.add('BACKUP.json', report('zip', result.copied, since || undefined))
  await close(part)
  await saveState({ zip: { at: started, files: result.copied } })
  return result
}
