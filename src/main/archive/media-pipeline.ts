import type { BlobRef, BlobStore } from '../../workers/archive/blob-store'

/**
 * Deciding which media to fetch, and putting what arrives into the blob store (PLAN.md Phase 3).
 *
 * The rules come from §10: documents always, images always, video only on request. That is not a
 * detail — an archive that eagerly pulls every forwarded video fills a disk in a week, and the
 * quota exists so it stops before it does.
 */

export interface MediaCandidate {
  id: string
  msgId?: string | null | undefined
  chatId?: string | null | undefined
  mime?: string | null | undefined
  size?: number | null | undefined
  filename?: string | null | undefined
}

export interface FetchRules {
  /** Video above this is left for a manual click. §10: "videos on click". */
  videoAutoMaxBytes?: number
  /** Nothing above this is fetched automatically, whatever its type. */
  hardMaxBytes?: number
  documents?: boolean
  images?: boolean
  audio?: boolean
}

export type FetchDecision =
  | { fetch: true; reason: 'document' | 'image' | 'audio' | 'video' | 'manual' }
  | { fetch: false; reason: string }

const DEFAULTS: Required<FetchRules> = {
  // Anything past this is a film, not a clip.
  videoAutoMaxBytes: 0,
  hardMaxBytes: 100 * 1024 * 1024,
  documents: true,
  images: true,
  audio: false,
}

export function decideFetch(
  candidate: MediaCandidate,
  rules: FetchRules = {},
  manual = false,
): FetchDecision {
  // A manual click overrides every rule except the hard ceiling: the user asked for this file.
  const merged = { ...DEFAULTS, ...rules }
  const size = candidate.size ?? 0
  const mime = (candidate.mime ?? '').toLowerCase()

  if (manual) return { fetch: true, reason: 'manual' }
  if (size > merged.hardMaxBytes) {
    return { fetch: false, reason: `larger than ${String(merged.hardMaxBytes)} bytes` }
  }

  if (mime.startsWith('image/')) {
    return merged.images ? { fetch: true, reason: 'image' } : { fetch: false, reason: 'images off' }
  }
  if (mime.startsWith('video/')) {
    if (!merged.videoAutoMaxBytes) return { fetch: false, reason: 'videos only on request' }
    return size <= merged.videoAutoMaxBytes
      ? { fetch: true, reason: 'video' }
      : { fetch: false, reason: 'video larger than the automatic limit' }
  }
  if (mime.startsWith('audio/')) {
    return merged.audio ? { fetch: true, reason: 'audio' } : { fetch: false, reason: 'audio off' }
  }
  if (mime !== '' || candidate.filename) {
    return merged.documents
      ? { fetch: true, reason: 'document' }
      : { fetch: false, reason: 'documents off' }
  }

  return { fetch: false, reason: 'unknown type' }
}

export interface StoreResult {
  ref: BlobRef
  /** False when the blob was already there — the dedupe, and what makes a retry safe. */
  written: boolean
}

/**
 * Puts fetched bytes into the store and reports the row update the archive needs.
 *
 * The quota is checked *before* writing: refusing a file is recoverable, filling the disk is not.
 */
export async function storeMedia(
  store: BlobStore,
  candidate: MediaCandidate,
  data: Buffer,
  usedBytes: number,
): Promise<{ status: 'done' | 'skipped'; sha256?: string; size?: number; reason?: string }> {
  const quota = store.quota(usedBytes)
  if (quota.exceeded) {
    return { status: 'skipped', reason: 'blob store quota reached' }
  }

  // put() is idempotent: an identical blob is not written twice, which is what makes a retried
  // download safe as well as what deduplicates a photo forwarded through five chats.
  const ref = await store.put(data, {
    mime: candidate.mime ?? null,
    filename: candidate.filename ?? null,
  })
  return { status: 'done', sha256: ref.sha256, size: ref.size }
}
