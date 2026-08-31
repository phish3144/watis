#!/usr/bin/env node
// The release gate (PLAN.md §8 and Phase 9).
//
// Everything that has to be true before a build goes out, in one command, with one exit code.
// Split from `verify` on purpose: `verify` is what runs on every commit and takes seconds, this
// takes minutes and is what runs before a tag.
//
//   npm run gate:release            — 500 000 messages, the everyday figure
//   npm run gate:release -- 5000000 — the plan's release figure; needs roughly 2 GB of disk

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const MESSAGES = process.argv[2] ?? '500000'

const steps = [
  { name: 'verify', command: 'npm', args: ['run', 'verify'] },
  { name: 'build', command: 'npm', args: ['run', 'build'] },
  { name: 'e2e', command: 'npx', args: ['playwright', 'test'] },
  {
    name: 'loadtest',
    command: 'node',
    args: ['scripts/loadtest-archive.mjs', MESSAGES],
    // The load test builds its own bundles; doing it here keeps the ordering explicit.
    before: { command: 'node', args: ['scripts/build-loadtest.mjs'] },
  },
]

const failed = []

for (const step of steps) {
  console.log(`\n── ${step.name}\n`)
  if (step.before) {
    const pre = spawnSync(step.before.command, step.before.args, { stdio: 'inherit', shell: false })
    if (pre.status !== 0) {
      failed.push(step.name)
      continue
    }
  }
  const result = spawnSync(step.command, step.args, { stdio: 'inherit', shell: false })
  // A step killed by a signal reports status null, which is a failure and not a pass — the shape
  // of mistake that lets a red gate through.
  if (result.status !== 0) failed.push(step.name)
}

console.log('')

if (existsSync('loadtest-report.json')) {
  const report = JSON.parse(readFileSync('loadtest-report.json', 'utf8'))
  console.log(
    `load test: ${report.messages.toLocaleString('de-DE')} messages, ` +
      `search p95 ${report.searchP95Ms.toFixed(2)} ms, ` +
      `import ${Math.round(report.importRowsPerSecond).toLocaleString('de-DE')} rows/s`,
  )
}

if (failed.length > 0) {
  console.error(`\nFAIL  ${failed.join(', ')}`)
  console.error('This build is not releasable.')
  process.exit(1)
}

console.log('\nok    every release gate met')
