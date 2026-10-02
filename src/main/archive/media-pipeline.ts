import type { BlobRef, BlobStore } from '../../workers/archive/blob-store'
import type { MediaCandidate } from './fetch-rules'

export {
  decideFetch,
  type FetchDecision,
  type FetchRules,
  type MediaCandidate,
} from './fetch-rules'

/**
 * Putting fetched media into the desktop's blob store (PLAN.md Phase 3). The rules for what to
 * fetch live in `fetch-rules.ts`, shared with the browser extension.
 */

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
