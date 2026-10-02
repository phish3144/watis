import { beforeEach, describe, expect, it } from 'vitest'
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import { wrap, type WasmDatabase } from '../../src/workers/archive/sqlite-wasm'

/**
 * The places where SQLite-WASM and better-sqlite3 differ, and the adapter has to make them agree.
 * The repository's behaviour on both engines is covered by the integration tests running twice
 * (vitest.config.ts); these pin down the adapter's own promises.
 */

const sqlite3 = await sqlite3InitModule()
let db: WasmDatabase

beforeEach(() => {
  db = wrap(sqlite3, new sqlite3.oo1.DB(':memory:', 'c'))
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, n INTEGER)')
})

describe('parameters', () => {
  it('binds named parameters by their bare name, whatever the prefix', () => {
    db.prepare('INSERT INTO t (name, n) VALUES (@name, :n)').run({ name: 'a', n: 1 })
    db.prepare('INSERT INTO t (name, n) VALUES ($name, @n)').run({ name: 'b', n: 2 })
    expect(db.prepare('SELECT name FROM t ORDER BY n').all()).toEqual([
      { name: 'a' },
      { name: 'b' },
    ])
  })

  it('binds positional values, spread or as an array', () => {
    db.prepare('INSERT INTO t (name, n) VALUES (?, ?)').run('a', 1)
    db.prepare('INSERT INTO t (name, n) VALUES (?, ?)').run(['b', 2])
    expect(db.prepare('SELECT count(*) AS c FROM t WHERE n IN (?, ?)').get(1, 2)).toEqual({ c: 2 })
  })

  it('ignores extra keys but refuses a missing one, like better-sqlite3', () => {
    const insert = db.prepare('INSERT INTO t (name) VALUES (@name)')
    expect(() => insert.run({ name: 'a', unused: 1 })).not.toThrow()
    expect(() => insert.run({ other: 'a' })).toThrow(/Missing named parameter "name"/)
  })

  it('refuses booleans and undefined rather than guessing a value for them', () => {
    const insert = db.prepare('INSERT INTO t (n) VALUES (?)')
    expect(() => insert.run(true)).toThrow(TypeError)
    expect(() => insert.run(undefined)).toThrow(TypeError)
  })

  it('round-trips integers past 32 bits, as the time-ordered rowid needs', () => {
    const big = 1_790_000_000 * 1_048_576 + 7
    db.prepare('INSERT INTO t (id, n) VALUES (?, ?)').run(big, big)
    expect(db.prepare('SELECT id, n FROM t').get()).toEqual({ id: big, n: big })
  })
})

describe('results', () => {
  it('reports changes and the last rowid', () => {
    const result = db.prepare('INSERT INTO t (name) VALUES (?)').run('a')
    expect(result).toEqual({ changes: 1, lastInsertRowid: 1 })
  })

  it('returns undefined from get() when there is no row', () => {
    expect(db.prepare('SELECT * FROM t WHERE id = ?').get(42)).toBeUndefined()
  })

  it('answers a simple pragma with its value', () => {
    db.pragma('user_version = 7')
    expect(db.pragma('user_version', { simple: true })).toBe(7)
    expect(db.pragma('user_version')).toEqual([{ user_version: 7 }])
  })
})

describe('transactions', () => {
  it('rolls the whole transaction back when the function throws', () => {
    const insertAll = db.transaction((names: string[]) => {
      for (const name of names) db.prepare('INSERT INTO t (name) VALUES (?)').run(name)
      throw new Error('stop')
    })
    expect(() => {
      insertAll(['a', 'b'])
    }).toThrow('stop')
    expect(db.prepare('SELECT count(*) AS c FROM t').get()).toEqual({ c: 0 })
  })

  it('turns a nested transaction into a savepoint that can fail on its own', () => {
    const inner = db.transaction(() => {
      db.prepare('INSERT INTO t (name) VALUES (?)').run('inner')
      throw new Error('inner failed')
    })
    const outer = db.transaction(() => {
      db.prepare('INSERT INTO t (name) VALUES (?)').run('outer')
      try {
        inner()
      } catch {
        // swallowed on purpose: the outer transaction carries on
      }
    })
    outer()
    expect(db.prepare('SELECT name FROM t').all()).toEqual([{ name: 'outer' }])
  })
})

describe('statement lifetime', () => {
  it('keeps working when a held statement was evicted from the cache meanwhile', () => {
    const held = db.prepare('SELECT count(*) AS c FROM t')
    // Push it out of the bounded cache: every distinct SQL text is a new entry.
    for (let i = 0; i < 300; i++) db.prepare(`SELECT ${String(i)} AS v`).get()
    expect(held.get()).toEqual({ c: 0 })
  })

  it('reuses the compiled statement for the same SQL text', () => {
    expect(db.prepare('SELECT 1')).toBe(db.prepare('SELECT 1'))
  })
})

describe('functions', () => {
  it('registers variadic functions, whatever the callback declares', () => {
    db.function('joined', { deterministic: true }, (...parts: unknown[]) => parts.join('-'))
    expect(db.prepare("SELECT joined('a', 'b', 'c') AS v").get()).toEqual({ v: 'a-b-c' })
  })
})
