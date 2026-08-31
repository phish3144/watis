import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../../src/main/logging', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { moveBlobStore } = await import('../../src/main/storage/move-blobs')

let root: string

const write = (path: string, content: string): void => {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'watis-move-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('moveBlobStore', () => {
  it('moves the sharded tree and keeps the layout', async () => {
    const from = join(root, 'blobs')
    const to = join(root, 'elsewhere')
    write(join(from, 'ab', 'cd', 'abcd1234.pdf'), 'ein Dokument')
    write(join(from, 'ef', '01', 'ef011234.png'), 'ein Bild')

    const result = await moveBlobStore(from, to)
    expect(result.moved).toBe(2)
    expect(readFileSync(join(to, 'ab', 'cd', 'abcd1234.pdf'), 'utf8')).toBe('ein Dokument')
    expect(existsSync(join(from, 'ab', 'cd', 'abcd1234.pdf'))).toBe(false)
  })

  it('does nothing when the target is the source', async () => {
    const from = join(root, 'blobs')
    write(join(from, 'ab', 'cd', 'x.bin'), 'unverändert')
    const result = await moveBlobStore(from, from)
    expect(result.moved).toBe(0)
    expect(readFileSync(join(from, 'ab', 'cd', 'x.bin'), 'utf8')).toBe('unverändert')
  })

  it('refuses a target inside the source', async () => {
    // It would walk the files it is still creating.
    const from = join(root, 'blobs')
    mkdirSync(from, { recursive: true })
    await expect(moveBlobStore(from, join(from, 'inner'))).rejects.toThrow(/inside/)
  })

  it('counts the bytes it moved', async () => {
    const from = join(root, 'blobs')
    const to = join(root, 'to')
    write(join(from, 'aa', 'bb', 'one.bin'), '12345')
    write(join(from, 'aa', 'bb', 'two.bin'), '123')
    const result = await moveBlobStore(from, to)
    expect(result.bytes).toBe(8)
  })

  it('copes with a source that is not there yet', async () => {
    const result = await moveBlobStore(join(root, 'missing'), join(root, 'to'))
    expect(result.moved).toBe(0)
    expect(existsSync(join(root, 'to'))).toBe(true)
  })
})
