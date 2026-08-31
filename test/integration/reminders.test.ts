import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { migrate, registerFunctions } from '../../src/workers/archive/db'
import { ArchiveRepository } from '../../src/workers/archive/repository'
import { LATEST_VERSION } from '../../src/workers/archive/schema'

let db: Database.Database
let repo: ArchiveRepository

const NOW = 1_700_000_000

beforeEach(() => {
  db = new Database(':memory:')
  registerFunctions(db)
  migrate(db)
  repo = new ArchiveRepository(db)
  repo.upsertChats([{ id: 'c1', name: 'Dachdecker' }])
  repo.upsertMessages([{ id: 'm1', chatId: 'c1', ts: NOW - 100, body: 'Angebot kommt' }])
})

describe('reminders', () => {
  it('arrives with the second migration, not the first', () => {
    // The migration list is append-only: a shipped migration is never edited, because databases in
    // the field have already run it.
    expect(LATEST_VERSION).toBeGreaterThanOrEqual(2)
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(LATEST_VERSION)
  })

  it('remembers a message with its text', () => {
    const id = repo.addReminder('m1', NOW + 3600, 'nachhaken')
    const [reminder] = repo.reminders()
    expect(reminder).toMatchObject({
      id,
      msgId: 'm1',
      note: 'nachhaken',
      chatId: 'c1',
      body: 'Angebot kommt',
    })
  })

  it('only reports what has actually come due', () => {
    repo.addReminder('m1', NOW - 10)
    repo.addReminder('m1', NOW + 10_000)
    expect(repo.dueReminders(NOW)).toHaveLength(1)
  })

  it('stops reporting one that was completed', () => {
    const id = repo.addReminder('m1', NOW - 10)
    expect(repo.dueReminders(NOW)).toHaveLength(1)
    repo.completeReminder(id)
    expect(repo.dueReminders(NOW)).toHaveLength(0)
    expect(repo.reminders()).toHaveLength(0)
    expect(repo.reminders(true)).toHaveLength(1)
  })

  it('completing twice is not an error', () => {
    // The timer and a click can both arrive. A reminder that fires twice because the second write
    // was refused would be the worse outcome.
    const id = repo.addReminder('m1', NOW - 10)
    repo.completeReminder(id)
    expect(() => {
      repo.completeReminder(id)
    }).not.toThrow()
  })

  it('survives a reminder about a message that is not archived', () => {
    // A reminder about a message that turns out not to be in the archive is still a reminder;
    // losing it because a row is missing would be worse than a dangling reference.
    repo.addReminder('does-not-exist', NOW - 10)
    const [reminder] = repo.dueReminders(NOW)
    expect(reminder?.msgId).toBe('does-not-exist')
    expect(reminder?.body).toBeNull()
    expect(reminder?.chatId).toBeNull()
  })

  it('lists soonest first', () => {
    repo.addReminder('m1', NOW + 300)
    repo.addReminder('m1', NOW + 100)
    repo.addReminder('m1', NOW + 200)
    expect(repo.reminders().map((r) => r.dueTs)).toEqual([NOW + 100, NOW + 200, NOW + 300])
  })
})
