#!/usr/bin/env node
/**
 * Proves better-sqlite3 loads inside Electron's own Node runtime with no rebuild step.
 *
 * This is the regression guard for the decision in ADR 0003: better-sqlite3 13 is Node-API and
 * ships prebuilds for every target, so @electron/rebuild is out of the build entirely. If a
 * future bump ever went back to a source build, this fails here rather than on a user's machine.
 *
 * Written as a script because it needs ELECTRON_RUN_AS_NODE=1, and `VAR=1 cmd` is not portable
 * to Windows shells.
 */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electron = require('electron')

const probe = `
const Database = require('better-sqlite3')
const db = new Database(':memory:')
const options = db.prepare('pragma compile_options').all().map((row) => row.compile_options)
const report = {
  electron: process.versions.electron,
  node: process.versions.node,
  modules: process.versions.modules,
  sqlite: db.prepare('select sqlite_version() v').get().v,
  fts5: options.includes('ENABLE_FTS5'),
}
db.exec("create virtual table t using fts5(x, tokenize='trigram')")
report.trigram = true
console.log(JSON.stringify(report))
`

const result = spawnSync(electron, ['-e', probe], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
})

if (result.status !== 0) {
  console.error('smoke test failed')
  console.error(result.stdout)
  console.error(result.stderr)
  process.exit(1)
}

const report = JSON.parse(result.stdout.trim().split('\n').pop())
console.log('better-sqlite3 under Electron:', JSON.stringify(report, null, 2))

if (!report.fts5) {
  console.error('FAIL: FTS5 is not compiled into the shipped binary')
  process.exit(1)
}
if (!report.trigram) {
  console.error('FAIL: the trigram tokenizer is unavailable')
  process.exit(1)
}
console.log('ok: loaded with no rebuild, FTS5 and trigram present')
