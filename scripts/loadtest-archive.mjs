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
//
// Exits non-zero when a gate is missed, and writes the full numbers to
// loadtest-report.json — so a release can point at the run rather than at a memory of one.

import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
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
  // Every batch is timed, not just the worst. SQLite checkpoints the WAL periodically, and that
  // one batch takes several times as long as its neighbours — a real effect, not a regression, so
  // gating on the maximum would gate on when the checkpoint happened to land.
  const batchTimings = []
  for (let i = 0; i < MESSAGES; i += BATCH) {
    const b0 = performance.now()
    writeBatch(i, Math.min(i + BATCH, MESSAGES))
    batchTimings.push(performance.now() - b0)
  }
  const importMs = performance.now() - t0
  batchTimings.sort((a, b) => a - b)
  const worstBatch = batchTimings[batchTimings.length - 1]

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

  // Index-queue throughput: claim/complete cycles per second. The engines themselves are not the
  // point here — OCR speed depends on the image, and it is measured against fixtures elsewhere.
  // What this covers is the part that scales with archive size: the queue's own SQL under a
  // backlog, which is where a bad index would show up.
  const { IndexQueue } = await import('../out/loadtest/queue.mjs')
  const queue = new IndexQueue(db)
  const QUEUE_JOBS = 2000
  const q0 = performance.now()
  for (let i = 0; i < QUEUE_JOBS; i++) queue.enqueue(`me${i}`, 'ocr', i % 3, 0)
  for (let i = 0; i < QUEUE_JOBS; i++) {
    const job = queue.claim(0)
    if (!job) break
    queue.complete(job.id, 0)
  }
  const queueMs = performance.now() - q0
  const jobsPerSecond = QUEUE_JOBS / (queueMs / 1000)

  const bytes = (await stat(file)).size
  const docs = db.prepare('SELECT count(*) AS n FROM search_docs').get().n
  const rssMiB = process.memoryUsage().rss / 1024 / 1024

  console.log(`
  messages        ${MESSAGES.toLocaleString('de-DE')}
  media rows      ${MEDIA.toLocaleString('de-DE')}
  search docs     ${docs.toLocaleString('de-DE')}
  database        ${(bytes / 1024 / 1024).toFixed(0)} MiB
  process RSS     ${rssMiB.toFixed(0)} MiB

  import          ${(importMs / 1000).toFixed(1)} s  (${Math.round(MESSAGES / (importMs / 1000)).toLocaleString('de-DE')} rows/s)
  batch p95       ${pct(batchTimings, 95).toFixed(1)} ms  (worst ${worstBatch.toFixed(1)} ms — a WAL checkpoint)
  media import    ${(mediaMs / 1000).toFixed(1)} s
  index queue     ${Math.round(jobsPerSecond).toLocaleString('de-DE')} jobs/s

  search (neueste zuerst)
          p50     ${pct(timings, 50).toFixed(2)} ms
          p95     ${pct(timings, 95).toFixed(2)} ms
          max     ${timings[timings.length - 1].toFixed(2)} ms
  search (Relevanz)
          p95     ${pct(relevance, 95).toFixed(2)} ms
  paging  p95     ${pct(pageTimings, 95).toFixed(2)} ms`)

  // The gates from PLAN.md §8. Each names what it protects, because a number with no reason
  // attached gets relaxed the first time it fails.
  const importRowsPerSecond = MESSAGES / (importMs / 1000)
  const gates = [
    {
      name: 'search p95',
      value: pct(timings, 95),
      limit: 200,
      unit: 'ms',
      why: 'finding an old message must feel instant, whatever the archive size',
    },
    {
      name: 'paging p95',
      value: pct(pageTimings, 95),
      limit: 50,
      unit: 'ms',
      why: 'scrolling up is keyset paging; it must not slow down as the chat grows',
    },
    {
      name: 'import batch p95',
      value: pct(batchTimings, 95),
      limit: 250,
      unit: 'ms',
      why: 'a batch is one transaction in the worker; the typical one must stay short even though a checkpoint occasionally is not',
    },
    {
      // 3 500 rows/s is roughly half of what this code does today (measured: 7 800 rows/s at
      // 500 000 messages, so 5 million in about eleven minutes). Set from the measurement rather
      // than from a wish: it catches a real halving of throughput without failing on a slow CI box.
      name: 'import throughput',
      value: importRowsPerSecond,
      limit: 3_500,
      unit: 'rows/s',
      atLeast: true,
      why: 'the initial mirror has to finish in minutes, not an evening',
    },
    {
      name: 'index queue throughput',
      value: jobsPerSecond,
      limit: 500,
      unit: 'jobs/s',
      atLeast: true,
      why: 'the queue itself must never be the bottleneck; the engines are slow enough',
    },
    {
      name: 'process RSS',
      value: rssMiB,
      limit: 1024,
      unit: 'MiB',
      why: 'the archive is paged and streamed; holding it in memory would defeat that',
    },
  ]

  console.log('')
  let failed = 0
  for (const gate of gates) {
    const ok = gate.atLeast ? gate.value >= gate.limit : gate.value <= gate.limit
    const comparison = gate.atLeast ? '>=' : '<='
    const line = `${gate.name.padEnd(24)} ${gate.value.toFixed(1).padStart(10)} ${gate.unit} ${comparison} ${String(gate.limit)}`
    if (ok) {
      console.log(`ok    ${line}`)
    } else {
      console.error(`FAIL  ${line}\n      ${gate.why}`)
      failed++
    }
  }

  await writeFile(
    'loadtest-report.json',
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        node: process.version,
        messages: MESSAGES,
        mediaRows: MEDIA,
        searchDocs: docs,
        databaseBytes: bytes,
        rssMiB,
        importSeconds: importMs / 1000,
        importRowsPerSecond,
        batchP95Ms: pct(batchTimings, 95),
        worstBatchMs: worstBatch,
        indexJobsPerSecond: jobsPerSecond,
        searchP50Ms: pct(timings, 50),
        searchP95Ms: pct(timings, 95),
        relevanceP95Ms: pct(relevance, 95),
        pagingP95Ms: pct(pageTimings, 95),
        gates,
        passed: failed === 0,
      },
      null,
      2,
    ),
  )

  if (failed > 0) {
    console.error(`\n${String(failed)} gate(s) missed — see PLAN.md §8`)
    process.exitCode = 1
  } else {
    console.log(`\nok    every gate met; numbers written to loadtest-report.json`)
  }
  db.close()
} finally {
  await rm(dir, { recursive: true, force: true })
}
