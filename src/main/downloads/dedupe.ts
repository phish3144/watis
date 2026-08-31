import { stat } from 'node:fs/promises'
import { sha256OfFile } from '../../workers/archive/blob-store'

/**
 * Deduplication for the download folder (PLAN.md Phase 2).
 *
 * Distinct from the blob store's dedupe, which addresses by hash and therefore gets it for free.
 * Here the files carry human names in chat folders, so the same photo forwarded twice really would
 * land twice — and the user sees it.
 *
 * Size is checked first: two files of different length cannot be the same file, and that comparison
 * costs a stat where hashing a 200 MB video costs seconds.
 */

export interface KnownFile {
  path: string
  size: number
  sha256?: string | undefined
}

export interface DedupeIndex {
  /** Files already downloaded, keyed by size for the cheap first pass. */
  bySize: Map<number, KnownFile[]>
}

export function emptyIndex(): DedupeIndex {
  return { bySize: new Map() }
}

export function remember(index: DedupeIndex, file: KnownFile): void {
  const bucket = index.bySize.get(file.size)
  if (bucket) bucket.push(file)
  else index.bySize.set(file.size, [file])
}

export function forget(index: DedupeIndex, path: string): void {
  for (const [size, bucket] of index.bySize) {
    const next = bucket.filter((f) => f.path !== path)
    if (next.length === 0) index.bySize.delete(size)
    else index.bySize.set(size, next)
  }
}

/**
 * Returns the path of an identical file already present, or undefined.
 *
 * `hashOf` is injected so the decision logic can be tested without touching a disk, and so a caller
 * can supply a hash it already knows from the archive rather than reading the file again.
 */
export async function findDuplicate(
  index: DedupeIndex,
  candidate: { size: number; sha256?: string | undefined },
  hashOf: (file: KnownFile) => Promise<string>,
): Promise<string | undefined> {
  const sameSize = index.bySize.get(candidate.size)
  if (!sameSize || sameSize.length === 0) return undefined

  // Only now is hashing worth it, and only for the handful of files of exactly this size.
  const candidateHash = candidate.sha256 ?? undefined
  if (candidateHash === undefined) return undefined

  for (const known of sameSize) {
    const hash = known.sha256 ?? (await hashOf(known))
    known.sha256 = hash
    if (hash === candidateHash) return known.path
  }
  return undefined
}

/** The disk-backed hasher used in production. */
export async function hashKnownFile(file: KnownFile): Promise<string> {
  return sha256OfFile(file.path)
}

/** Reads a file's size, or undefined when it is gone — a stale index entry is not an error. */
export async function sizeOf(path: string): Promise<number | undefined> {
  try {
    const s = await stat(path)
    return s.isFile() ? s.size : undefined
  } catch {
    return undefined
  }
}
