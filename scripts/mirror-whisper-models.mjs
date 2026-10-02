// Fetches the speech models the browser extension offers, checks them against the pinned SHA-256,
// and prints the commands that put them on the project's own GitHub release (ADR 0012).
//
//   node scripts/mirror-whisper-models.mjs              all models, into .cache/whisper/
//   node scripts/mirror-whisper-models.mjs base         just one (the E2E test uses `base`)
//   node scripts/mirror-whisper-models.mjs --out DIR    somewhere else
//
// The source is whisper.cpp's own model repository on Hugging Face; the extension never talks to
// it. Users download from the GitHub release, which a maintainer fills once with the files this
// script fetched and checked. It does not upload anything itself: publishing is a deliberate act.
//
// The release is a *prerelease* on purpose. The desktop updater asks GitHub for the latest
// release; a release that carries only model files must never be the one it finds.

import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(
  await readFile(join(root, 'src', 'extension', 'whisper-models.json'), 'utf8'),
)

const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const out = outIndex >= 0 ? resolve(args[outIndex + 1] ?? '') : join(root, '.cache', 'whisper')
const wanted = args.filter(
  (arg, i) => !arg.startsWith('--') && (outIndex < 0 || i !== outIndex + 1),
)
const keys = wanted.length > 0 ? wanted : Object.keys(config.models)
for (const key of keys) {
  if (!(key in config.models)) {
    console.error(`unknown model "${key}"; known: ${Object.keys(config.models).join(', ')}`)
    process.exit(2)
  }
}

async function sha256(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

mkdirSync(out, { recursive: true })
const files = []
for (const key of keys) {
  const model = config.models[key]
  const target = join(out, model.file)
  if (existsSync(target) && (await sha256(target)) === model.sha256) {
    console.log(`ok    ${model.file} (already here)`)
    files.push(target)
    continue
  }
  const response = await fetch(`${config.source}/${model.file}`)
  if (!response.ok || !response.body) {
    console.error(`fail  ${model.file}: HTTP ${String(response.status)}`)
    process.exit(1)
  }
  const partial = `${target}.part`
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
  const actual = await sha256(partial)
  if (actual !== model.sha256) {
    rmSync(partial)
    console.error(`fail  ${model.file}: SHA-256 ${actual}, expected ${model.sha256}`)
    process.exit(1)
  }
  renameSync(partial, target)
  console.log(`ok    ${model.file} (${String(Math.round(model.bytes / 1e6))} MB, checked)`)
  files.push(target)
}

const tag = config.release.split('/').pop()
console.log(`
To publish them on the project's release (once, by a maintainer):

  gh release create ${tag} --prerelease --title "Sprachmodelle für die Transkription" \\
    --notes "whisper.cpp-Modelle (MIT), unverändert von ${config.source}. Prüfsummen: src/extension/whisper-models.json"
  gh release upload ${tag} --clobber ${files.map((f) => `"${f}"`).join(' ')}
`)
