#!/usr/bin/env node
// One gate that actually fails.
//
// Chaining `npm run lint | tail -3 && git commit` looks like it checks something, but a pipe
// reports the exit code of `tail`, which always succeeds. This ran green over two real lint errors.
// Everything below runs to completion and then fails loudly if anything did.

import { spawnSync } from 'node:child_process'

const steps = ['format:check', 'lint', 'typecheck', 'test', 'verify:no-elevate']
const failed = []

for (const step of steps) {
  process.stdout.write(`── ${step}\n`)
  const result = spawnSync('npm', ['run', step], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) failed.push(step)
}

if (failed.length > 0) {
  console.error(`\nFAIL  ${failed.join(', ')}`)
  process.exit(1)
}
console.log('\nok    all checks passed')
