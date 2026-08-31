// Pure helpers for repairing electron-builder's release metadata after an external
// signing service has rewritten the binaries.
//
// electron-builder computes sha512, size and the blockmap while it packs, which is
// BEFORE SignPath ever sees the file. Every one of those values is stale by the time
// the signed binary comes back, and electron-updater refuses an update whose hash does
// not match — so the metadata has to be recomputed against the signed bytes.

/**
 * Replace the recorded hash and size of every file in a parsed `latest.yml` for which
 * we have freshly measured values. Entries we have no measurement for are left alone
 * rather than silently dropped.
 *
 * `latest.yml` carries the same digest twice: once per entry under `files`, and once
 * more at the top level for the primary artefact named by `path`. Both must move
 * together, or electron-updater validates against whichever it happens to read first.
 *
 * @param {object} latest parsed latest.yml
 * @param {Map<string, {sha512: string, size: number}>} measured keyed by file name
 * @returns {{latest: object, updated: string[], missing: string[]}}
 */
export function applyMeasuredHashes(latest, measured) {
  if (latest == null || typeof latest !== 'object') {
    throw new TypeError('latest.yml did not parse to an object')
  }
  const next = structuredClone(latest)
  const updated = []
  const missing = []

  for (const entry of next.files ?? []) {
    const m = measured.get(entry.url)
    if (m == null) {
      missing.push(entry.url)
      continue
    }
    entry.sha512 = m.sha512
    entry.size = m.size
    updated.push(entry.url)
  }

  // The top-level digest describes the artefact named by `path`.
  if (typeof next.path === 'string') {
    const m = measured.get(next.path)
    if (m != null) next.sha512 = m.sha512
  }

  return { latest: next, updated, missing }
}

/**
 * Which artefacts in a release directory need their blockmap rebuilt.
 * electron-builder only emits a `.blockmap` for targets that support differential
 * updates, so the presence of the sibling file is the signal — inventing one for the
 * portable build would put a file in the release that nothing reads.
 *
 * @param {string[]} presentFiles every file name in the release directory
 * @returns {string[]} artefacts that already have a sibling `.blockmap`
 */
export function artefactsWithBlockmap(presentFiles) {
  const names = new Set(presentFiles)
  return presentFiles.filter((f) => !f.endsWith('.blockmap') && names.has(`${f}.blockmap`))
}
