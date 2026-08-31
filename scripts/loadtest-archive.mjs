#!/usr/bin/env node
// Load test for the archive (PLAN.md §8, release gate for phases 3, 4 and 7).
//
// Imports synthetic messages and media, then measures search latency. The point is not the absolute
// numbers — they depend on the machine — but that the shape holds: import stays a batched write and
// search stays bounded, so neither degrades with archive size.
//
//   node scripts/loadtest-archive.mjs [messages] [mediaRows]
//
// Defaults to 500 000 messages. The plan's release-gate figure is 5 000 000; pass it explicitly,
// because the database then needs roughly 2 GB of disk.

import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { indexForm } from '../out/loadtest/normalise.mjs'
import { ArchiveRepository } from '../out/loadtest/repository.mjs'
import { parseQuery } from '../out/loadtest/query.mjs'

const MESSAGES = Number(process.argv[2] ?? 500_000)
const MEDIA = Number(process.argv[3] ?? Math.round(MESSAGES / 50))
const BATCH = 500 // §3.1: batches, never one transaction per row

const WORDS = [
  'Rechnung',
  'Termin',
  'München',
  'Grüße',
  'Straße',
  'Angebot',
  'Lieferung',
  'Vertrag',
  'Besprechung',
  'Unterlagen',
  'Rückfrage',
  'Änderung',
  'Bestätigung',
  'Anhang',
  'Frist',
]
const CHATS = 200

const pct = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]

function body(i) {
  const a = WORDS[i % WORDS.length]
  const b = WORDS[(i * 7 + 3) % WORDS.length]
  const c = WORDS[(i * 13 + 5) % WORDS.length]
  return `${a} ${b} zu Vorgang ${i} ${c}`
}

const dir = await mkdtemp(join(tmpdir(), 'watis-loadtest-'))
const file = join(dir, 'archive.sqlite')

try {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.function('wa_index_form', { deterministic: true }, (t) =>
    typeof t === 'string' ? indexForm(t) : null,
  )

  const { MIGRATIONS } = await import('../out/loadtest/schema.mjs')
  for (const m of MIGRATIONS) db.exec(m.sql)

  db.prepare('INSERT INTO chats (id, name, kind) VALUES (?, ?, ?)')
  const chatStmt = db.prepare("INSERT INTO chats (id, name, kind) VALUES (?, ?, 'group')")
  const insertChats = db.transaction(() => {
    for (let c = 0; c < CHATS; c++) chatStmt.run(`c${c}`, `Chat ${c}`)
  })
  insertChats()

  const msgStmt = db.prepare(
    'INSERT INTO messages (id, chat_id, sender_jid, ts, kind, body) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const writeBatch = db.transaction((from, to) => {
    for (let i = from; i < to; i++) {
      msgStmt.run(`m${i}`, `c${i % CHATS}`, `u${i % 500}@s`, 1_600_000_000 + i, 'chat', body(i))
    }
  })

  console.log(`importing ${MESSAGES.toLocaleString('de-DE')} messages in batches of ${BATCH} …`)
  const t0 = performance.now()
  let worstBatch = 0
  for (let i = 0; i < MESSAGES; i += BATCH) {
    const b0 = performance.now()
    writeBatch(i, Math.min(i + BATCH, MESSAGES))
    worstBatch = Math.max(worstBatch, performance.now() - b0)
  }
  const importMs = performance.now() - t0

  const mediaStmt = db.prepare(
    'INSERT INTO media (id, msg_id, chat_id, mime, size, sha256, filename, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
  const writeMedia = db.transaction((from, to) => {
    for (let i = from; i < to; i++) {
      mediaStmt.run(
        `me${i}`,
        `m${i * 50}`,
        `c${i % CHATS}`,
        i % 3 === 0 ? 'image/jpeg' : 'application/pdf',
        100_000 + i,
        `sha${i}`,
        `Anhang-München-${i}.pdf`,
        'done',
      )
    }
  })
  const t1 = performance.now()
  for (let i = 0; i < MEDIA; i += BATCH) writeMedia(i, Math.min(i + BATCH, MEDIA))
  const mediaMs = performance.now() - t1

  // Measured through the shipping repository, not hand-written SQL, so the gate covers the code
  // that actually runs.
  const repo = new ArchiveRepository(db)
  const queries = ['München', 'Rechnung', 'Rechnung Termin', 'Strasse', 'Grüße', 'Vorgang'].map(
    (q) => parseQuery(q),
  )
  for (const q of queries) repo.search(q)

  const measure = (order) => {
    const t = []
    for (let round = 0; round < 200; round++) {
      const q = queries[round % queries.length]
      const s = performance.now()
      repo.search(q, 50, 0, order)
      t.push(performance.now() - s)
    }
    return t.sort((a, b) => a - b)
  }
  const timings = measure('recent')
  const relevance = measure('relevance')

  const pageStmt = db.prepare(
    'SELECT id, ts FROM messages WHERE chat_id = ? AND (ts, id) < (?, ?) ORDER BY ts DESC, id DESC LIMIT 50',
  )
  const pageTimings = []
  let cursor = { ts: 2_000_000_000, id: 'zzz' }
  for (let i = 0; i < 200; i++) {
    const s = performance.now()
    const rows = pageStmt.all('c1', cursor.ts, cursor.id)
    pageTimings.push(performance.now() - s)
    if (rows.length === 0) cursor = { ts: 2_000_000_000, id: 'zzz' }
    else cursor = rows[rows.length - 1]
  }
  pageTimings.sort((a, b) => a - b)

  const bytes = (await stat(file)).size
  const docs = db.prepare('SELECT count(*) AS n FROM search_docs').get().n

  console.log(`
  messages        ${MESSAGES.toLocaleString('de-DE')}
  media rows      ${MEDIA.toLocaleString('de-DE')}
  search docs     ${docs.toLocaleString('de-DE')}
  database        ${(bytes / 1024 / 1024).toFixed(0)} MiB

  import          ${(importMs / 1000).toFixed(1)} s  (${Math.round(MESSAGES / (importMs / 1000)).toLocaleString('de-DE')} rows/s)
  worst batch     ${worstBatch.toFixed(1)} ms
  media import    ${(mediaMs / 1000).toFixed(1)} s

  search (neueste zuerst)
          p50     ${pct(timings, 50).toFixed(2)} ms
          p95     ${pct(timings, 95).toFixed(2)} ms
          max     ${timings[timings.length - 1].toFixed(2)} ms
  search (Relevanz)
          p95     ${pct(relevance, 95).toFixed(2)} ms
  paging  p95     ${pct(pageTimings, 95).toFixed(2)} ms`)

  const p95 = pct(timings, 95)
  if (p95 > 200) {
    console.error(`\nFAIL  search p95 ${p95.toFixed(1)} ms exceeds the 200 ms gate from PLAN.md §8`)
    process.exitCode = 1
  } else {
    console.log(`\nok    search p95 ${p95.toFixed(2)} ms is within the 200 ms gate`)
  }
  db.close()
} finally {
  await rm(dir, { recursive: true, force: true })
}
