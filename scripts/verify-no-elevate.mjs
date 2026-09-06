#!/usr/bin/env node
/**
 * Release gate for the no-admin-rights constraint.
 *
 * Two checks, both cheap and both catching a regression that would otherwise only show up on a
 * user's locked-down machine:
 *
 *  1. resources/elevate.exe must NOT exist in the packaged app. Its absence is the hardest
 *     guarantee there is that neither the installer nor the updater can elevate — there is
 *     simply no binary to call.
 *  2. The NSIS flags that make that true must still be set in electron-builder.yml. A future
 *     edit flipping oneClick to false would silently reintroduce the "install for all users"
 *     radio page, whose handler calls UAC_RunElevated.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

let failed = false

function fail(message) {
  console.error(`FAIL  ${message}`)
  failed = true
}
function pass(message) {
  console.log(`ok    ${message}`)
}

// --- 1. configuration -------------------------------------------------------
const config = readFileSync('electron-builder.yml', 'utf8')
const required = [
  ['oneClick: true', 'oneClick must be true, or NSIS compiles in the per-all-users radio page'],
  ['perMachine: false', 'perMachine must be false, or the manifest asks for admin'],
  ['packElevateHelper: false', 'packElevateHelper must be false to drop resources/elevate.exe'],
  ['npmRebuild: false', 'npmRebuild must be false; better-sqlite3 13 needs no rebuild'],
  ['deleteAppDataOnUninstall: false', 'uninstall must never delete the archive'],
]
for (const [needle, why] of required) {
  if (config.includes(needle)) pass(needle)
  else fail(`${needle} missing from electron-builder.yml — ${why}`)
}

// --- 2. packaged output -----------------------------------------------------
// The custom NSIS include is the one place project code lands inside the installer, so it is the
// one place a "just this once" elevation could be added without touching the three config flags.
const nsis = 'build/installer.nsh'
if (existsSync(nsis)) {
  // Comments are stripped first: the header of that file explains which elevation mechanisms are
  // forbidden, and a check that trips on the sentence forbidding a thing is a check nobody keeps.
  const script = readFileSync(nsis, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/(^|\s)[;#].*$/, ''))
    .join('\n')
  const forbidden = [
    [/RequestExecutionLevel\s+(admin|highest)/i, 'RequestExecutionLevel admin'],
    [/UAC::/i, 'the UAC plugin'],
    [/"runas"/i, 'ExecShell runas'],
    [/HKLM/i, 'a HKLM write'],
    [/SetShellVarContext\s+all/i, 'SetShellVarContext all'],
  ]
  let clean = true
  for (const [pattern, what] of forbidden) {
    if (pattern.test(script)) {
      fail(`${nsis} contains ${what}`)
      clean = false
    }
  }
  if (clean) pass(`${nsis} does not elevate`)
} else if (config.includes('include:')) {
  // electron-builder.yml names the script, so its absence is not "nothing to check" — it is a
  // packaging failure waiting to happen on a machine that does not have the file. It was: the
  // file was gitignored, so every Windows build in CI died on "cannot find specified resource"
  // while the local build, which had it, was fine. A check that shrugs at a missing file it was
  // written to inspect is worse than no check.
  fail(`electron-builder.yml includes ${nsis}, but the file is missing`)
} else {
  console.log(`note  ${nsis} is absent and nothing references it`)
}

/**
 * Every file electron-builder.yml points at must exist AND be tracked by git.
 *
 * Existing is not enough: `build/` was gitignored, so the icons and the NSIS include were present
 * on the machine that made them and absent everywhere else. The result was a Windows package that
 * could not be built at all, and — for months before that — a shipped application wearing the
 * default Electron icon, with nothing failing to say so.
 */
const referenced = [
  ...config.matchAll(/^\s*(?:icon|include|entitlements|entitlementsInherit):\s*(\S+)/gm),
]
  .map((m) => m[1].replace(/['"]/g, ''))
  .filter((value, index, all) => all.indexOf(value) === index)

const tracked = new Set(
  execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean),
)

for (const file of referenced) {
  if (!existsSync(file)) fail(`electron-builder.yml references ${file}, which does not exist`)
  else if (!tracked.has(file)) {
    fail(`${file} is referenced by electron-builder.yml but is not tracked by git`)
  } else pass(`${file} exists and is tracked`)
}

function findElevate(dir) {
  if (!existsSync(dir)) return []
  const hits = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) hits.push(...findElevate(full))
    else if (entry.toLowerCase() === 'elevate.exe') hits.push(full)
  }
  return hits
}

if (existsSync('release')) {
  const hits = findElevate('release')
  if (hits.length === 0) pass('no elevate.exe in release/')
  else fail(`elevate.exe found: ${hits.join(', ')}`)
} else {
  console.log('note  release/ not built yet; skipped the packaged-output check')
}

process.exit(failed ? 1 : 0)
