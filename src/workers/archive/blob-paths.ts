/**
 * Where a blob lives, derived from its content: `<aa>/<bb>/<sha256>.<ext>` (PLAN.md §5.3).
 *
 * Pure, so the desktop store on disk and the browser store in OPFS lay files out identically —
 * a blob copied from one to the other lands at the same relative path (ADR 0010).
 */

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
