import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, registerFunctions } from '../../src/workers/archive/db'
import { ArchiveRepository } from '../../src/workers/archive/repository'
import { BlobStore } from '../../src/workers/archive/blob-store'
import { runBackup, runExport } from '../../src/workers/archive/backup'
import { parseQuery } from '@shared/search/query'

let db: Database.Database
let repo: ArchiveRepository
let blobs: BlobStore
let root: string

const countFiles = (directory: string): number => {
  if (!existsSync(directory)) return 0
  let n = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    n += entry.isDirectory() ? countFiles(join(directory, entry.name)) : 1
  }
  return n
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'watis-backup-'))
  db = new Database(join(root, 'archive.sqlite'))
  registerFunctions(db)
  migrate(db)
  repo = new ArchiveRepository(db)
  blobs = new BlobStore(join(root, 'blobs'), 1024 * 1024 * 1024)

  repo.upsertChats([{ id: 'c1', name: 'Dachdecker', kind: 'dm' }])
  repo.upsertMessages([
    { id: 'm1', chatId: 'c1', ts: 1_700_000_000, body: 'Angebot kommt morgen' },
    { id: 'm2', chatId: 'c1', ts: 1_700_000_100, body: 'Hier ist es', mediaId: 'd1' },
  ])
  repo.upsertMedia([
    { id: 'd1', msgId: 'm2', chatId: 'c1', mime: 'application/pdf', filename: 'angebot.pdf' },
  ])

  const ref = await blobs.put(Buffer.from('%PDF-1.4 pretend'), {
    mime: 'application/pdf',
    filename: 'angebot.pdf',
  })
  repo.attachBlob('d1', ref.sha256, ref.size)
})

afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})

describe('runBackup', () => {
  it('writes a database and every blob it references', async () => {
    // A database without its blobs restores to an archive full of dead links, which is the kind of
    // backup people discover is useless at the worst possible moment.
    const target = join(root, 'backup')
    const result = await runBackup(repo, blobs, { targetDir: target, includeBlobs: true })

    expect(existsSync(result.databaseFile)).toBe(true)
    expect(result.blobsCopied).toBe(1)
    expect(result.blobsMissing).toBe(0)
    expect(countFiles(join(target, 'blobs'))).toBe(1)
  })

  it('restores: the copy opens on its own and still answers a search', async () => {
    const target = join(root, 'backup')
    await runBackup(repo, blobs, { targetDir: target, includeBlobs: true })

    const restored = new Database(join(target, 'archive.sqlite'))
    registerFunctions(restored)
    try {
      const hits = new ArchiveRepository(restored).search(parseQuery('Angebot'), 10)
      expect(hits.length).toBeGreaterThan(0)
    } finally {
      restored.close()
    }
  })

  it('reports a missing blob instead of failing the whole backup', async () => {
    repo.upsertMedia([{ id: 'd2', msgId: 'm1', chatId: 'c1', mime: 'image/png' }])
    repo.attachBlob('d2', 'f'.repeat(64), 10)

    const target = join(root, 'backup')
    const result = await runBackup(repo, blobs, { targetDir: target, includeBlobs: true })
    expect(result.blobsCopied).toBe(1)
    expect(result.blobsMissing).toBe(1)

    const report = JSON.parse(readFileSync(join(target, 'BACKUP.json'), 'utf8')) as {
      report: { ok: boolean; missingBlobs: string[] }
    }
    expect(report.report.ok).toBe(false)
    expect(report.report.missingBlobs).toContain('d2')
  })

  it('skips the blobs when asked, and says the backup is complete without them', async () => {
    const target = join(root, 'backup')
    const result = await runBackup(repo, blobs, { targetDir: target, includeBlobs: false })
    expect(result.blobsCopied).toBe(0)
    expect(countFiles(join(target, 'blobs'))).toBe(0)

    const report = JSON.parse(readFileSync(join(target, 'BACKUP.json'), 'utf8')) as {
      report: { ok: boolean }
    }
    expect(report.report.ok).toBe(true)
  })

  it('overwrites a previous backup rather than refusing', async () => {
    // VACUUM INTO will not write over an existing file, and a backup that stops working after the
    // first run is a backup nobody has.
    const target = join(root, 'backup')
    await runBackup(repo, blobs, { targetDir: target, includeBlobs: true })
    const second = await runBackup(repo, blobs, { targetDir: target, includeBlobs: true })
    expect(statSync(second.databaseFile).size).toBeGreaterThan(0)
  })
})

describe('runExport', () => {
  it('writes readable files per chat', async () => {
    const target = join(root, 'export')
    const result = await runExport(repo, blobs, {
      targetDir: target,
      formats: ['json', 'txt'],
      incremental: false,
    })
    expect(result.chats).toBe(1)
    expect(result.messages).toBe(2)
    expect(result.files.some((f) => f.endsWith('.txt'))).toBe(true)
  })

  it('adds only what is new on the second run', async () => {
    const target = join(root, 'export')
    await runExport(repo, blobs, { targetDir: target, formats: ['json'], incremental: true })

    const again = await runExport(repo, blobs, {
      targetDir: target,
      formats: ['json'],
      incremental: true,
    })
    expect(again.messages).toBe(0)
    expect(again.skipped).toBe(1)

    repo.upsertMessages([{ id: 'm3', chatId: 'c1', ts: 1_700_100_000, body: 'Nachtrag' }])
    const third = await runExport(repo, blobs, {
      targetDir: target,
      formats: ['json'],
      incremental: true,
    })
    expect(third.messages).toBe(1)
  })

  it('exports the whole chat again when the run is not incremental', async () => {
    const target = join(root, 'export')
    await runExport(repo, blobs, { targetDir: target, formats: ['json'], incremental: true })
    const full = await runExport(repo, blobs, {
      targetDir: target,
      formats: ['json'],
      incremental: false,
    })
    expect(full.messages).toBe(2)
  })
})
