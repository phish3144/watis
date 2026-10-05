import { extensionFor, shardPath } from '../../workers/archive/blob-paths'

/**
 * The media store in the browser: `blobs/<aa>/<bb>/<sha256>.<ext>` in the extension's OPFS, the
 * same layout as the desktop's `blobs/` directory (PLAN.md §5.3, ADR 0010).
 *
 * Content addressing carries over unchanged, and with it deduplication: a photo forwarded through
 * five chats is one file. OPFS belongs to the extension's origin, not to WhatsApp's, so clearing
 * WhatsApp's site data does not touch it — only uninstalling the extension does, which is why the
 * panel offers the export to a real folder as a first-class action rather than a footnote.
 *
 * Runs in the archive worker: synchronous access handles exist only in dedicated workers, and they
 * are what every browser supports for writing into OPFS.
 */

/** Only the members used here; lib.dom does not declare the worker-only half of OPFS. */
interface SyncAccessHandle {
  write(buffer: Uint8Array, options?: { at?: number }): number
  truncate(size: number): void
  flush(): void
  close(): void
}
type WorkerFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle(): Promise<SyncAccessHandle>
  move?(name: string): Promise<void>
}

export interface StoredBlob {
  sha256: string
  size: number
  /** Relative to the OPFS root, forward slashes — what the panel opens to show the file. */
  path: string
}

export class OpfsBlobStore {
  readonly #root: FileSystemDirectoryHandle

  private constructor(root: FileSystemDirectoryHandle) {
    this.#root = root
  }

  static async open(): Promise<OpfsBlobStore> {
    const origin = await navigator.storage.getDirectory()
    return new OpfsBlobStore(await origin.getDirectoryHandle('blobs', { create: true }))
  }

  static pathFor(sha256: string, mime?: string | null, filename?: string | null): string {
    return `blobs/${shardPath(sha256, extensionFor(mime, filename))}`
  }

  /**
   * Stores bytes under their hash. Idempotent: an identical blob is not written twice, which is
   * what makes a retried download safe as well as what deduplicates.
   *
   * Written to `<name>.part` first and renamed when complete, where the browser can rename in
   * OPFS. A worker killed mid-write — a closed tab — then leaves a `.part` behind, never a
   * truncated file under a real hash that the dedupe check would trust forever.
   */
  async put(
    bytes: Uint8Array,
    meta: { mime?: string | null; filename?: string | null },
  ): Promise<StoredBlob> {
    const sha256 = await sha256Hex(bytes)
    const path = OpfsBlobStore.pathFor(sha256, meta.mime, meta.filename)
    const [, a, b, name] = path.split('/')
    if (!a || !b || !name) throw new Error(`unexpected blob path ${path}`)

    const level1 = await this.#root.getDirectoryHandle(a, { create: true })
    const dir = await level1.getDirectoryHandle(b, { create: true })
    if (await sizeOf(dir, name)) return { sha256, size: bytes.length, path }

    const partial = (await dir.getFileHandle(`${name}.part`, { create: true })) as WorkerFileHandle
    await writeAll(partial, bytes)
    if (typeof partial.move === 'function') {
      await partial.move(name)
    } else {
      await writeAll((await dir.getFileHandle(name, { create: true })) as WorkerFileHandle, bytes)
      await dir.removeEntry(`${name}.part`)
    }
    return { sha256, size: bytes.length, path }
  }

  /** Writes a file at a path relative to the OPFS root, replacing it — for exports, not blobs. */
  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    const parts = path.split('/')
    const name = parts.pop()
    if (!name) throw new Error(`not a file path: ${path}`)
    let dir = await navigator.storage.getDirectory()
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true })
    await writeAll((await dir.getFileHandle(name, { create: true })) as WorkerFileHandle, bytes)
  }

  /** Reads a file at a path relative to the OPFS root — an import the panel put there. */
  async readFile(path: string): Promise<Uint8Array> {
    const parts = path.split('/')
    const name = parts.pop()
    if (!name) throw new Error(`not a file path: ${path}`)
    let dir = await navigator.storage.getDirectory()
    for (const part of parts) dir = await dir.getDirectoryHandle(part)
    return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer())
  }

  /** Whether the file for this path is present and non-empty. */
  async has(path: string): Promise<boolean> {
    const parts = path.split('/')
    const name = parts.pop()
    if (!name || parts.shift() !== 'blobs') return false
    try {
      let dir = this.#root
      for (const part of parts) dir = await dir.getDirectoryHandle(part)
      return (await sizeOf(dir, name)) > 0
    } catch {
      return false
    }
  }
}

async function sizeOf(dir: FileSystemDirectoryHandle, name: string): Promise<number> {
  try {
    return (await (await dir.getFileHandle(name)).getFile()).size
  } catch {
    return 0
  }
}

async function writeAll(handle: WorkerFileHandle, bytes: Uint8Array): Promise<void> {
  const access = await handle.createSyncAccessHandle()
  try {
    access.truncate(0)
    let written = 0
    while (written < bytes.length) {
      written += access.write(bytes.subarray(written), { at: written })
    }
    access.flush()
  } finally {
    access.close()
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

/** base64 to bytes without `Buffer` — the bridge hands media over as base64 in JSON. */
export function fromBase64(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
