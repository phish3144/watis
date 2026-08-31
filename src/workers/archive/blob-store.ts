import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

/**
 * Content-addressed media store: `blobs/<aa>/<bb>/<sha256>.<ext>` (PLAN.md §5.3).
 *
 * Addressing by content buys deduplication for free — the same photo forwarded through five chats is
 * one file — and the two-level shard keeps any single directory to a few thousand entries, which is
 * what keeps a directory listing usable on Windows.
 *
 * The path is never stored in the database; it is derived from the hash (§5.4). That is what makes
 * the whole store relocatable to another drive without touching a single row.
 */

export interface BlobRef {
  sha256: string
  size: number
  /** Path relative to the store root, always with forward slashes. */
  relativePath: string
}

export interface QuotaState {
  bytes: number
  limitBytes: number
  /** 0..1; the UI warns from 0.9. */
  used: number
  exceeded: boolean
}

/** Extensions are normalised, so `.JPEG` and `.jpeg` cannot produce two files for one hash. */
export function extensionFor(mime: string | null | undefined, filename?: string | null): string {
  const fromName = filename?.match(/\.([A-Za-z0-9]{1,8})$/)?.[1]?.toLowerCase()
  if (fromName) return fromName
  const known: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
  }
  return known[(mime ?? '').toLowerCase()] ?? 'bin'
}

export function shardPath(sha256: string, extension: string): string {
  // Two levels of two hex characters: 256 directories at each level, so a million blobs average
  // about sixteen files per leaf.
  return `${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.${extension}`
}

export function sha256Of(data: Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

export async function sha256OfFile(file: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

export class BlobStore {
  readonly #root: string
  readonly #limitBytes: number
  #bytes = 0

  constructor(root: string, limitBytes: number) {
    this.#root = root
    this.#limitBytes = limitBytes
  }

  get root(): string {
    return this.#root
  }

  /**
   * Writes a blob and returns its reference. A blob already present is not written again — that is
   * the deduplication, and it also makes the whole operation idempotent, which matters because a
   * media download that is retried must not corrupt what is already there.
   */
  async put(
    data: Buffer,
    options: { mime?: string | null; filename?: string | null } = {},
  ): Promise<BlobRef> {
    const sha256 = sha256Of(data)
    const relativePath = shardPath(sha256, extensionFor(options.mime, options.filename))
    const target = join(this.#root, relativePath)

    const existing = await this.#sizeOf(target)
    if (existing !== undefined) {
      return { sha256, size: existing, relativePath }
    }

    await mkdir(join(target, '..'), { recursive: true })
    // Write beside the target and rename, so a crash mid-write can never leave a truncated file
    // sitting at the address of a hash it does not match.
    const temporary = `${target}.${process.pid.toString(36)}.part`
    await writeFile(temporary, data)
    await rename(temporary, target)
    this.#bytes += data.byteLength

    return { sha256, size: data.byteLength, relativePath }
  }

  pathFor(sha256: string, mime?: string | null, filename?: string | null): string {
    return join(this.#root, shardPath(sha256, extensionFor(mime, filename)))
  }

  async has(sha256: string, mime?: string | null, filename?: string | null): Promise<boolean> {
    return (await this.#sizeOf(this.pathFor(sha256, mime, filename))) !== undefined
  }

  async delete(sha256: string, mime?: string | null, filename?: string | null): Promise<boolean> {
    const target = this.pathFor(sha256, mime, filename)
    const size = await this.#sizeOf(target)
    if (size === undefined) return false
    await rm(target, { force: true })
    this.#bytes = Math.max(0, this.#bytes - size)
    return true
  }

  /** Bytes counted since this instance opened, plus whatever it was told at construction. */
  quota(baseBytes = 0): QuotaState {
    const bytes = baseBytes + this.#bytes
    return {
      bytes,
      limitBytes: this.#limitBytes,
      used: this.#limitBytes > 0 ? bytes / this.#limitBytes : 0,
      exceeded: this.#limitBytes > 0 && bytes >= this.#limitBytes,
    }
  }

  async #sizeOf(file: string): Promise<number | undefined> {
    try {
      const s = await stat(file)
      return s.isFile() ? s.size : undefined
    } catch {
      return undefined
    }
  }
}
