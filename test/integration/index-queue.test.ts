import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, registerFunctions } from '../../src/workers/archive/db'
import { IndexQueue, type Job } from '../../src/workers/content-index/queue'

let db: Database.Database
let queue: IndexQueue

beforeEach(() => {
  db = new Database(':memory:')
  registerFunctions(db)
  migrate(db)
  db.prepare("INSERT INTO chats (id, name, kind) VALUES ('c1','Familie','group')").run()
  for (const id of ['me1', 'me2', 'me3']) {
    db.prepare(
      "INSERT INTO media (id, chat_id, mime, status) VALUES (?, 'c1', 'image/jpeg', 'done')",
    ).run(id)
  }
  queue = new IndexQueue(db)
})

/** Claims a job and fails the test rather than the type checker if the queue is empty. */
function mustClaim(): Job {
  const job = queue.claim()
  if (!job) throw new Error('expected a claimable job, queue was empty')
  return job
}

describe('IndexQueue', () => {
  it('claims the highest priority first', () => {
    queue.enqueue('me1', 'ocr', 20)
    queue.enqueue('me2', 'pdf', 30)
    expect(queue.claim()?.mediaId).toBe('me2')
  })

  it('prefers newer media within the same priority', () => {
    // §7: new before old, so a fresh screenshot is searchable before a year-old backlog.
    queue.enqueue('me1', 'ocr', 20)
    queue.enqueue('me3', 'ocr', 20)
    expect(queue.claim()?.mediaId).toBe('me3')
  })

  it('does not hand the same job to two claimants', () => {
    queue.enqueue('me1', 'ocr')
    expect(queue.claim()?.mediaId).toBe('me1')
    expect(queue.claim()).toBeUndefined()
  })

  it('is idempotent per media and kind', () => {
    const first = queue.enqueue('me1', 'ocr')
    expect(queue.enqueue('me1', 'ocr')).toBe(first)
    expect(queue.counts().queued).toBe(1)
  })

  it('allows different kinds for the same media', () => {
    // A scanned PDF is both a pdf job and, page by page, an ocr job.
    queue.enqueue('me1', 'pdf')
    queue.enqueue('me1', 'ocr')
    expect(queue.counts().queued).toBe(2)
  })

  it('requeues below the attempt limit and fails at it', () => {
    queue.enqueue('me1', 'ocr')
    const job = mustClaim()
    expect(queue.fail(job.id, 'kaputt')).toBe('requeued')

    const again = mustClaim()
    expect(again.attempts).toBe(1)
    expect(queue.fail(again.id, 'kaputt')).toBe('requeued')
    expect(queue.fail(mustClaim().id, 'kaputt')).toBe('failed')
    expect(queue.claim()).toBeUndefined()
    expect(queue.counts().failed).toBe(1)
  })

  it('backs off further with each attempt and stops growing', () => {
    expect(IndexQueue.backoffMs(1)).toBe(5000)
    expect(IndexQueue.backoffMs(2)).toBe(10_000)
    expect(IndexQueue.backoffMs(3)).toBe(20_000)
    expect(IndexQueue.backoffMs(50)).toBe(10 * 60_000)
  })

  it('records a skip so it is never retried', () => {
    queue.skip('me1', 'ocr', 'sticker')
    expect(queue.claim()).toBeUndefined()
    expect(queue.counts().skipped).toBe(1)
  })

  it('completes a job and clears its error', () => {
    queue.enqueue('me1', 'ocr')
    const job = mustClaim()
    queue.fail(job.id, 'einmal daneben')
    queue.complete(mustClaim().id)

    expect(queue.counts()).toMatchObject({ done: 1, queued: 0 })
    const row = db.prepare('SELECT last_error FROM index_jobs WHERE id = ?').get(job.id)
    expect(row).toEqual({ last_error: null })
  })

  it('re-indexes one source without touching the others', () => {
    queue.enqueue('me1', 'ocr')
    queue.enqueue('me1', 'pdf')
    queue.complete(mustClaim().id)
    queue.complete(mustClaim().id)

    expect(queue.reindex('ocr')).toBe(1)
    expect(queue.claim()?.kind).toBe('ocr')
  })

  it('puts jobs a crash left running back in the queue', () => {
    queue.enqueue('me1', 'ocr')
    queue.claim()
    expect(queue.counts().running).toBe(1)

    expect(queue.recoverStale()).toBe(1)
    expect(queue.claim()?.mediaId).toBe('me1')
  })

  it('truncates an enormous error rather than storing it whole', () => {
    queue.enqueue('me1', 'ocr')
    const job = mustClaim()
    queue.fail(job.id, 'x'.repeat(5000))
    const row = db.prepare('SELECT last_error FROM index_jobs WHERE id = ?').get(job.id) as {
      last_error: string
    }
    expect(row.last_error).toHaveLength(1000)
  })
})
