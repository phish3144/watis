/**
 * Deciding which media to fetch (PLAN.md Phase 3), with no storage attached — so the browser
 * extension applies exactly the same rules as the desktop (ADR 0010).
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
  const merged = { ...DEFAULTS, ...rules }
  const size = candidate.size ?? 0
  const mime = (candidate.mime ?? '').toLowerCase()

  // The hard ceiling is checked before anything else, a click included. It is not there to
  // second-guess the user's taste — it is there so a single file cannot fill the disk, and a limit
  // that any click gets past is not a limit (§10, "harte Obergrenze").
  if (size > merged.hardMaxBytes) {
    return { fetch: false, reason: `larger than ${String(merged.hardMaxBytes)} bytes` }
  }
  // Past the ceiling, a click overrides every other rule: the user asked for this file.
  if (manual) return { fetch: true, reason: 'manual' }

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
