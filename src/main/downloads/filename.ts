// Downloads-side path handling: collisions on a real disk, and the folder scheme.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  MAX_PATH_LENGTH,
  byteLength,
  dateStamp,
  extname,
  sanitiseComponent,
  sanitiseFilename,
  truncateToBytes,
} from '@shared/files/sanitise'

// The pure rules live in shared/files so the browser extension names files the same way. This
// module keeps what needs a real filesystem, and re-exports the rest so existing imports stand.
export {
  MAX_PATH_LENGTH,
  extname,
  sanitiseComponent,
  sanitiseFilename,
  truncateToBytes,
  type SanitiseOptions,
} from '@shared/files/sanitise'

/**
 * Adds " (2)", " (3)" … until the path is free, and keeps the whole path under MAX_PATH_LENGTH
 * by shortening the stem rather than by failing.
 */
export function resolveCollision(
  directory: string,
  filename: string,
  exists: (path: string) => boolean = existsSync,
): string {
  const extension = extname(filename)
  const stem = extension ? filename.slice(0, filename.length - extension.length) : filename

  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const suffix = attempt === 1 ? '' : ` (${attempt})`
    let candidateStem = stem
    let candidate = join(directory, `${candidateStem}${suffix}${extension}`)

    // Shorten the stem until the full path fits.
    while (candidate.length > MAX_PATH_LENGTH && candidateStem.length > 1) {
      candidateStem = truncateToBytes(candidateStem, Math.max(1, byteLength(candidateStem) - 8))
      candidate = join(directory, `${candidateStem}${suffix}${extension}`)
    }

    if (!exists(candidate)) return candidate
  }
  throw new Error(`could not find a free name for ${filename} in ${directory}`)
}

/** `~/Downloads/WhatsApp/<Chat>/<YYYY-MM-DD>_<Name>` */
export function buildDownloadPath(options: {
  root: string
  chatName: string
  filename: string
  date: Date
  sortByChat: boolean
}): { directory: string; filename: string } {
  const { root, chatName, filename, date, sortByChat } = options
  const directory = sortByChat
    ? join(root, sanitiseComponent(chatName || 'Unsortiert', { fallback: 'Unsortiert' }))
    : root
  return { directory, filename: `${dateStamp(date)}_${sanitiseFilename(filename)}` }
}
