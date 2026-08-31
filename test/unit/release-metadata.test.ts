import { describe, expect, it } from 'vitest'
import {
  applyMeasuredHashes,
  artefactsWithBlockmap,
  type LatestYml,
} from '../../scripts/lib/release-metadata.mjs'

const latest = (): LatestYml => ({
  version: '0.1.0',
  files: [
    { url: 'WatIs-Setup-x64.exe', sha512: 'stale-setup', size: 1 },
    { url: 'WatIs-Portable-x64.exe', sha512: 'stale-portable', size: 2 },
  ],
  path: 'WatIs-Setup-x64.exe',
  sha512: 'stale-setup',
})

const measured = (entries: [string, { sha512: string; size: number }][]) => new Map(entries)

describe('applyMeasuredHashes', () => {
  it('moves the per-file and the top-level digest together', () => {
    // These two carry the same value for the primary artefact. Updating only one of
    // them leaves electron-updater validating against whichever it reads first.
    const { latest: out } = applyMeasuredHashes(
      latest(),
      measured([
        ['WatIs-Setup-x64.exe', { sha512: 'signed-setup', size: 122_523_319 }],
        ['WatIs-Portable-x64.exe', { sha512: 'signed-portable', size: 122_356_118 }],
      ]),
    )

    expect(out.files?.[0]).toEqual({
      url: 'WatIs-Setup-x64.exe',
      sha512: 'signed-setup',
      size: 122_523_319,
    })
    expect(out.sha512).toBe('signed-setup')
  })

  it('reports files it could not measure instead of shipping a stale hash', () => {
    const { updated, missing } = applyMeasuredHashes(
      latest(),
      measured([['WatIs-Setup-x64.exe', { sha512: 'signed-setup', size: 10 }]]),
    )

    expect(updated).toEqual(['WatIs-Setup-x64.exe'])
    expect(missing).toEqual(['WatIs-Portable-x64.exe'])
  })

  it('leaves the caller’s object untouched', () => {
    const input = latest()
    applyMeasuredHashes(input, measured([['WatIs-Setup-x64.exe', { sha512: 'signed', size: 9 }]]))

    expect(input.sha512).toBe('stale-setup')
    expect(input.files?.[0]?.sha512).toBe('stale-setup')
  })

  it('tolerates a latest.yml with no files list', () => {
    const { latest: out } = applyMeasuredHashes({ version: '0.1.0' }, measured([]))
    expect(out).toEqual({ version: '0.1.0' })
  })

  it('refuses input that is not an object', () => {
    expect(() => applyMeasuredHashes(null, measured([]))).toThrow(TypeError)
  })
})

describe('artefactsWithBlockmap', () => {
  it('picks only artefacts that already have a sibling blockmap', () => {
    // The portable build has none, and inventing one would put a file in the release
    // that no updater ever reads.
    expect(
      artefactsWithBlockmap([
        'WatIs-Setup-x64.exe',
        'WatIs-Setup-x64.exe.blockmap',
        'WatIs-Portable-x64.exe',
        'latest.yml',
      ]),
    ).toEqual(['WatIs-Setup-x64.exe'])
  })

  it('never returns the blockmaps themselves', () => {
    expect(artefactsWithBlockmap(['a.exe', 'a.exe.blockmap'])).not.toContain('a.exe.blockmap')
  })

  it('returns nothing when no blockmap is present', () => {
    expect(artefactsWithBlockmap(['WatIs-Portable-x64.exe', 'latest.yml'])).toEqual([])
  })
})
