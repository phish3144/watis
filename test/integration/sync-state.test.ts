import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, registerFunctions } from '../../src/workers/archive/db'
import { ArchiveRepository } from '../../src/workers/archive/repository'

let db: Database.Database
let repo: ArchiveRepository

beforeEach(() => {
  db = new Database(':memory:')
  registerFunctions(db)
  migrate(db)
  repo = new ArchiveRepository(db)
})

describe('sync_state', () => {
  it('records where a chat got to', () => {
    repo.saveSyncState([{ chatId: 'c1', oldestTs: 1_700_000_000, depthLimitTs: 1_690_000_000 }])
    const [row] = repo.syncState('c1')
    expect(row).toMatchObject({
      chatId: 'c1',
      oldestTs: 1_700_000_000,
      depthLimitTs: 1_690_000_000,
      backfillDone: false,
    })
  })

  it('only ever moves oldest_ts backwards', () => {
    // A later run that fetched less must not erase how far an earlier one reached, or a restart
    // would keep re-walking ground it already has.
    repo.saveSyncState([{ chatId: 'c1', oldestTs: 1_690_000_000 }])
    repo.saveSyncState([{ chatId: 'c1', oldestTs: 1_700_000_000 }])
    expect(repo.syncState('c1')[0]?.oldestTs).toBe(1_690_000_000)

    repo.saveSyncState([{ chatId: 'c1', oldestTs: 1_680_000_000 }])
    expect(repo.syncState('c1')[0]?.oldestTs).toBe(1_680_000_000)
  })

  it('only ever moves newest_ts forwards', () => {
    repo.saveSyncState([{ chatId: 'c1', newestTs: 1_700_000_000 }])
    repo.saveSyncState([{ chatId: 'c1', newestTs: 1_690_000_000 }])
    expect(repo.syncState('c1')[0]?.newestTs).toBe(1_700_000_000)
  })

  it('keeps the depth limit when a later write does not know it', () => {
    // The limit comes from WhatsApp and is not always answerable; a null must not overwrite the
    // last real answer with "unknown".
    repo.saveSyncState([{ chatId: 'c1', depthLimitTs: 1_690_000_000 }])
    repo.saveSyncState([{ chatId: 'c1', oldestTs: 1_695_000_000 }])
    expect(repo.syncState('c1')[0]?.depthLimitTs).toBe(1_690_000_000)
  })

  it('clears an error once a later attempt succeeds', () => {
    repo.saveSyncState([{ chatId: 'c1', lastError: 'timeout' }])
    repo.saveSyncState([{ chatId: 'c1', backfillDone: true }])
    const [row] = repo.syncState('c1')
    expect(row?.lastError).toBeNull()
    expect(row?.backfillDone).toBe(true)
  })

  it('lists everything, highest priority first', () => {
    repo.saveSyncState([
      { chatId: 'c1', priority: 0 },
      { chatId: 'c2', priority: 5 },
      { chatId: 'c3', priority: 2 },
    ])
    expect(repo.syncState().map((r) => r.chatId)).toEqual(['c2', 'c3', 'c1'])
  })

  it('writes a batch in one transaction', () => {
    const written = repo.saveSyncState(
      Array.from({ length: 200 }, (_, i) => ({ chatId: `c${i}`, oldestTs: 1_700_000_000 + i })),
    )
    expect(written).toBe(200)
    expect(repo.syncState()).toHaveLength(200)
  })
})
