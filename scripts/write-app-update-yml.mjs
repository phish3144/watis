#!/usr/bin/env node
// Writes resources/app-update.yml into an unpacked build.
//
// electron-builder normally emits this file from its afterPack hook, but the two-phase
// signing build never reaches that hook: `doPack` returns early whenever `prepackaged`
// is set, and the `--dir` pass does not qualify either, because the hook only fires for
// an nsis target. Both passes therefore skip it, and the result is an app that installs
// fine and never updates — a failure that shows up months later, in the field.
//
//   node scripts/write-app-update-yml.mjs <appOutDir> [publisherName]

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { load } from 'js-yaml'
import { serializeToYaml } from 'builder-util'

const appOutDir = resolve(process.argv[2] ?? 'release/win-unpacked')
const publisherName = process.argv[3]

const builderConfig = load(await readFile(resolve('electron-builder.yml'), 'utf8'))
const pkg = JSON.parse(await readFile(resolve('package.json'), 'utf8'))

const publish = builderConfig?.publish
if (publish?.provider !== 'github' || !publish.owner || !publish.repo) {
  throw new Error('electron-builder.yml has no usable github publish block')
}

const config = {
  provider: 'github',
  owner: publish.owner,
  repo: publish.repo,
  // Mirrors AppInfo.updaterCacheDirName: sanitized product name, lowercased, + "-updater".
  updaterCacheDirName: `${(builderConfig.productName ?? pkg.name).toLowerCase()}-updater`,
}

// publisherName is a one-way door. Once a build ships with it, every installed copy
// checks the signature of future updates against that exact string — and rejects an
// unsigned one forever. It is therefore set only when we really are signing.
if (publisherName) config.publisherName = [publisherName]

const resourcesDir = join(appOutDir, 'resources')
await mkdir(resourcesDir, { recursive: true })
const target = join(resourcesDir, 'app-update.yml')
await writeFile(target, serializeToYaml(config))
console.log(
  `wrote ${target}${publisherName ? ` (publisherName: ${publisherName})` : ' (unsigned)'}`,
)
