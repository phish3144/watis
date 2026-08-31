import { readdir, mkdir, rename, copyFile, rm, stat } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { log } from '../logging'

/**
 * Moving the blob store to another location (PLAN.md Phase 3).
 *
 * People run out of room on a system drive long before they run out on the one they bought for
 * exactly this, and media is where the size is. The database stays put: it is small, and the
 * application is unusable without it, so putting it on a drive that might be unplugged would be a
 * bad trade.
 *
 * Copy-then-verify-then-delete, never a bare rename across devices. A `rename` between filesystems
 * fails with EXDEV, and the copy fallback has to leave the source intact until the destination is
 * confirmed — the one moment where getting this wrong loses files that exist nowhere else.
 */

export interface MoveResult {
  moved: number
  bytes: number
  from: string
  to: string
}

export async function moveBlobStore(from: string, to: string): Promise<MoveResult> {
  const source = resolve(from)
  const target = resolve(to)

  if (source === target) return { moved: 0, bytes: 0, from: source, to: target }
  if (target.startsWith(`${source}/`) || target.startsWith(`${source}\\`)) {
    // Moving a directory into itself would walk the files it is still creating.
    throw new Error('the new location cannot be inside the old one')
  }

  await mkdir(target, { recursive: true })
  const result: MoveResult = { moved: 0, bytes: 0, from: source, to: target }

  const walk = async (directory: string): Promise<void> => {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (!entry.isFile()) continue

      const destination = join(target, relative(source, full))
      await mkdir(join(destination, '..'), { recursive: true })

      const size = (await stat(full)).size
      try {
        await rename(full, destination)
      } catch {
        // Across devices, or onto a filesystem that will not take a rename. Copy, confirm the size
        // matches, and only then remove the original.
        await copyFile(full, destination)
        const copied = await stat(destination)
        if (copied.size !== size) {
          throw new Error(
            `copy of ${full} is ${String(copied.size)} bytes, expected ${String(size)}`,
          )
        }
        await rm(full, { force: true })
      }
      result.moved++
      result.bytes += size
    }
  }

  await walk(source)
  log.info(`moved ${String(result.moved)} blobs (${String(result.bytes)} bytes) to ${target}`)
  return result
}
