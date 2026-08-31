import { describe, expect, it, vi } from 'vitest'
import {
  emptyIndex,
  findDuplicate,
  forget,
  remember,
  type KnownFile,
} from '../../src/main/downloads/dedupe'
import { decideAutoArchive, kindOf } from '../../src/main/downloads/auto-archive'

describe('dedupe', () => {
  const hashOf = (map: Record<string, string>) =>
    vi.fn((f: KnownFile) => Promise.resolve(map[f.path] ?? 'unknown'))

  it('finds a file with the same size and hash', async () => {
    const index = emptyIndex()
    remember(index, { path: '/dl/a.jpg', size: 100 })
    const hash = hashOf({ '/dl/a.jpg': 'abc' })

    expect(await findDuplicate(index, { size: 100, sha256: 'abc' }, hash)).toBe('/dl/a.jpg')
  })

  it('never hashes when no file has the same size', async () => {
    // Two files of different length cannot be the same file, and hashing a 200 MB video costs
    // seconds where a size comparison costs nothing.
    const index = emptyIndex()
    remember(index, { path: '/dl/a.jpg', size: 100 })
    const hash = hashOf({})

    expect(await findDuplicate(index, { size: 999, sha256: 'abc' }, hash)).toBeUndefined()
    expect(hash).not.toHaveBeenCalled()
  })

  it('reports no duplicate when sizes collide but content differs', async () => {
    const index = emptyIndex()
    remember(index, { path: '/dl/a.jpg', size: 100 })
    expect(
      await findDuplicate(index, { size: 100, sha256: 'other' }, hashOf({ '/dl/a.jpg': 'abc' })),
    ).toBeUndefined()
  })

  it('caches the hash it computed, so a third file of the same size is cheap', async () => {
    const index = emptyIndex()
    remember(index, { path: '/dl/a.jpg', size: 100 })
    const hash = hashOf({ '/dl/a.jpg': 'abc' })

    await findDuplicate(index, { size: 100, sha256: 'x' }, hash)
    await findDuplicate(index, { size: 100, sha256: 'y' }, hash)
    expect(hash).toHaveBeenCalledTimes(1)
  })

  it('cannot decide without a hash for the candidate', async () => {
    const index = emptyIndex()
    remember(index, { path: '/dl/a.jpg', size: 100 })
    expect(await findDuplicate(index, { size: 100 }, hashOf({}))).toBeUndefined()
  })

  it('forgets a file that was deleted', async () => {
    const index = emptyIndex()
    remember(index, { path: '/dl/a.jpg', size: 100 })
    forget(index, '/dl/a.jpg')
    expect(await findDuplicate(index, { size: 100, sha256: 'abc' }, hashOf({}))).toBeUndefined()
    expect(index.bySize.size).toBe(0)
  })
})

describe('kindOf', () => {
  it('classifies by mime type', () => {
    expect(kindOf('image/jpeg')).toBe('image')
    expect(kindOf('application/pdf')).toBe('document')
    expect(kindOf('audio/ogg')).toBe('audio')
  })

  it('falls back to the extension', () => {
    expect(kindOf(null, 'Rechnung.PDF')).toBe('document')
    expect(kindOf(null, 'clip.MP4')).toBe('video')
  })

  it('says other for anything it cannot place', () => {
    expect(kindOf('application/octet-stream', 'blob')).toBe('document')
    expect(kindOf(null, 'noextension')).toBe('other')
  })
})

describe('decideAutoArchive', () => {
  const documentsInFamily = { chat: 'Familie', kinds: ['document'] as const }

  it('saves what a matching rule covers', () => {
    const decision = decideAutoArchive([documentsInFamily], {
      chat: 'Familie',
      mime: 'application/pdf',
    })
    expect(decision.save).toBe(true)
    expect(decision.rule).toBe(documentsInFamily)
  })

  it('ignores a chat the rule does not name', () => {
    expect(
      decideAutoArchive([documentsInFamily], { chat: 'Arbeit', mime: 'application/pdf' }).save,
    ).toBe(false)
  })

  it('ignores a kind the rule does not cover', () => {
    expect(
      decideAutoArchive([documentsInFamily], { chat: 'Familie', mime: 'image/jpeg' }).save,
    ).toBe(false)
  })

  it('matches every chat with a wildcard', () => {
    expect(
      decideAutoArchive([{ chat: '*', kinds: ['image'] }], { chat: 'Irgendwo', mime: 'image/png' })
        .save,
    ).toBe(true)
  })

  it('says which rule declined on size rather than staying silent', () => {
    const rule = { chat: '*', kinds: ['video'] as const, maxBytes: 1000 }
    const decision = decideAutoArchive([rule], { chat: 'x', mime: 'video/mp4', size: 5000 })
    expect(decision).toMatchObject({ save: false, rule })
    expect(decision.reason).toContain('1000')
  })

  it('skips a disabled rule without deleting it', () => {
    expect(
      decideAutoArchive([{ ...documentsInFamily, enabled: false }], {
        chat: 'Familie',
        mime: 'application/pdf',
      }).save,
    ).toBe(false)
  })

  it('takes the first matching rule', () => {
    const first = { chat: '*', kinds: ['document'] as const, maxBytes: 10 }
    const second = { chat: '*', kinds: ['document'] as const }
    expect(
      decideAutoArchive([first, second], { chat: 'x', mime: 'application/pdf', size: 50 }),
    ).toMatchObject({ save: false, rule: first })
  })

  it('explains an empty rule set', () => {
    expect(decideAutoArchive([], { chat: 'x', mime: 'application/pdf' }).reason).toBe(
      'no rule matched',
    )
  })
})
