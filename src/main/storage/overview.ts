import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { session } from 'electron'
import { WA_PARTITION } from '@shared/app-identity'
import { buildOverview, type StorageOverview } from '@shared/extras/storage-overview'
import { appPaths } from '../paths'
import { log } from '../logging'

/**
 * Measures the real directories behind the storage overview (PLAN.md Phase 9).
 *
 * All of it is async and none of it is cheap — walking `blobs/` means stat-ing every file — so it
 * runs on request and never on a timer. Main must not do synchronous disk work at all (§5.6), and
 * even async work of this size has no business happening unasked.
 */

/**
 * Which subdirectories of a session partition are disposable. This is the same list the update test
 * asserts against, for the same reason: everything NOT on it — IndexedDB, Local Storage,
 * service-worker registrations — is the login, and clearing it means scanning the QR code again
 * (CLAUDE.md, "Session ist heilig").
 */
const DISPOSABLE_CACHE_DIRS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Shared Dictionary',
]

async function directorySize(path: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(path, { withFileTypes: true })
  } catch {
    // A directory that does not exist yet weighs nothing, which is the honest answer.
    return 0
  }
  for (const entry of entries) {
    const full = join(path, entry.name)
    if (entry.isDirectory()) {
      total += await directorySize(full)
    } else if (entry.isFile()) {
      try {
        total += (await stat(full)).size
      } catch {
        /* removed between readdir and stat */
      }
    }
  }
  return total
}

async function cacheSize(root: string): Promise<number> {
  let total = 0
  for (const name of DISPOSABLE_CACHE_DIRS) total += await directorySize(join(root, name))
  return total
}

export async function measureStorage(): Promise<StorageOverview> {
  const paths = appPaths()

  // The default session and the persistent WhatsApp partition each keep their own caches.
  const sessionCacheBytes =
    (await cacheSize(paths.session)) + (await cacheSize(join(paths.session, 'Partitions', 'wa')))

  return buildOverview({
    sessionCacheBytes,
    archiveBytes: await directorySize(paths.archive),
    blobBytes: await directorySize(paths.blobs),
    modelBytes: await directorySize(paths.models),
    // The queue lives inside the archive database, so it is already counted there. Reporting it
    // twice would make the total wrong, and a total that does not add up is worse than a gap.
    indexQueueBytes: 0,
    logBytes: await directorySize(paths.logs),
  })
}

/**
 * Clears exactly the disposable caches and nothing else.
 *
 * `clearStorageData` is deliberately not used: called bare it also wipes cookies, IndexedDB and
 * local storage, which is the one thing this application must never do to that partition.
 */
export async function clearDisposableCaches(): Promise<void> {
  for (const partition of [session.defaultSession, session.fromPartition(WA_PARTITION)]) {
    try {
      await partition.clearCache()
      await partition.clearCodeCaches({ urls: [] })
    } catch (error: unknown) {
      log.warn(`could not clear a cache: ${String(error)}`)
    }
  }
  log.info('cleared HTTP and code caches; storage was not touched')
}
