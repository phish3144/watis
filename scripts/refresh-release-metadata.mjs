#!/usr/bin/env node
// Repairs release metadata after external signing.
//
// Run this AFTER the signed installers have been written back into the release
// directory and BEFORE anything is uploaded. It rebuilds every blockmap and rewrites
// latest.yml so electron-updater validates against the bytes users actually download.
//
//   node scripts/refresh-release-metadata.mjs [releaseDir]

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { load } from 'js-yaml'
import { serializeToYaml } from 'builder-util'
import { buildBlockMap } from 'app-builder-lib/out/targets/blockmap/blockmap.js'
import { applyMeasuredHashes, artefactsWithBlockmap } from './lib/release-metadata.mjs'

const releaseDir = resolve(process.argv[2] ?? 'release')
const latestPath = join(releaseDir, 'latest.yml')

const present = await readdir(releaseDir)
const targets = artefactsWithBlockmap(present)

if (targets.length === 0) {
  console.error(`No artefact with a sibling .blockmap found in ${releaseDir}. Nothing to repair.`)
  process.exit(1)
}

const measured = new Map()
for (const name of targets) {
  const file = join(releaseDir, name)
  // buildBlockMap rewrites the .blockmap and returns the digest of the file as it is
  // on disk right now — which after signing is the only digest that matters.
  const { sha512, size } = await buildBlockMap(file, 'gzip', `${file}.blockmap`)
  measured.set(name, { sha512, size })
  console.log(`rebuilt blockmap  ${name}  size=${size}`)
}

const latest = load(await readFile(latestPath, 'utf8'))
const { latest: repaired, updated, missing } = applyMeasuredHashes(latest, measured)

// A file listed in latest.yml that we could not measure would ship a stale hash and
// break every update. Fail loudly rather than publish it.
if (missing.length > 0) {
  console.error(`latest.yml lists artefacts with no rebuilt blockmap: ${missing.join(', ')}`)
  process.exit(1)
}

await writeFile(latestPath, serializeToYaml(repaired))
console.log(`rewrote latest.yml for: ${updated.join(', ')}`)
