import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { attachArchive, migrate, openArchive } from '../../src/workers/archive/db'
import { LATEST_VERSION } from '../../src/workers/archive/schema'

/**
 * Exactly one process migrates the archive; everybody else attaches and checks.
 *
 * This is not style. The archive worker and the content index both open the same file, and when
 * both ran the migrations the second one occasionally failed at startup with no pattern — a
 * deferred transaction upgrading to a write lock while the other holds it is not something
 * `busy_timeout` rescues.
 */

let root: string
let file: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'watis-ownership-'))
  file = join(root, 'archive.sqlite')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('schema ownership', () => {
  it('refuses to attach to a database nobody has migrated yet', () => {
    // A fresh file is at version 0. The content index must wait, not proceed against no schema.
    new Database(file).close()
    expect(() => attachArchive(file)).toThrow(/waiting for/)
  })

  it('attaches once the owner has migrated', () => {
    const owner = openArchive(file)
    try {
      const second = attachArchive(file)
      try {
        expect(Number(second.pragma('user_version', { simple: true }))).toBe(LATEST_VERSION)
        // And it can actually read what the owner wrote.
        owner.prepare(`INSERT INTO chats (id, name) VALUES ('c1', 'Test')`).run()
        expect(second.prepare('SELECT count(*) AS n FROM chats').get()).toEqual({ n: 1 })
      } finally {
        second.close()
      }
    } finally {
      owner.close()
    }
  })

  it('does not migrate on attach, however far behind the file is', () => {
    const owner = openArchive(file)
    owner.pragma('user_version = 0')
    owner.close()

    expect(() => attachArchive(file)).toThrow()
    // The file is untouched: attaching is a read of the version, never a write of the schema.
    const check = new Database(file)
    try {
      expect(Number(check.pragma('user_version', { simple: true }))).toBe(0)
    } finally {
      check.close()
    }
  })

  it('refuses a file from a newer build rather than running old code against it', () => {
    const db = openArchive(file)
    try {
      db.pragma(`user_version = ${String(LATEST_VERSION + 5)}`)
      expect(() => migrate(db)).toThrow(/only knows/)
    } finally {
      db.close()
    }
  })

  it('leaves the owner able to write while a second connection reads', () => {
    // WAL is what makes two processes on one file workable at all; this is the property the
    // content index relies on.
    const owner = openArchive(file)
    const reader = attachArchive(file)
    try {
      expect(String(owner.pragma('journal_mode', { simple: true })).toLowerCase()).toBe('wal')
      owner.prepare(`INSERT INTO chats (id, name) VALUES ('c2', 'Zwei')`).run()
      expect(reader.prepare(`SELECT name FROM chats WHERE id = 'c2'`).get()).toEqual({
        name: 'Zwei',
      })
    } finally {
      reader.close()
      owner.close()
    }
  })
})
