import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  newestTs,
  readExportState,
  writeExport,
  writeExportState,
} from '../../src/workers/archive/export-writer'
import type { ExportChat } from '../../src/workers/archive/export'

let root: string
let blobDir: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'watis-export-'))
  blobDir = join(root, 'blobs')
  await writeFile(join(root, 'placeholder'), '')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const chat = (messages: ExportChat['messages']): ExportChat => ({
  chat: { id: 'c1', name: 'Familie Müller', kind: 'group' },
  messages,
})

async function makeBlob(name: string, content = 'inhalt'): Promise<string> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(blobDir, { recursive: true })
  const path = join(blobDir, name)
  await writeFile(path, content)
  return path
}

describe('writeExport', () => {
  it('writes all three formats into a folder named after the chat', async () => {
    const result = await writeExport({
      chat: chat([{ id: 'm1', chatId: 'c1', ts: 1000, body: 'Hallo' }]),
      targetDir: join(root, 'out'),
      formats: ['json', 'html', 'txt'],
      blobPathFor: () => undefined,
    })

    expect(result.files).toHaveLength(3)
    const files = await readdir(join(root, 'out', 'Familie Müller'))
    expect(files.sort()).toEqual([
      'Familie Müller.html',
      'Familie Müller.json',
      'Familie Müller.txt',
      'media',
    ])
  })

  it('sanitises a chat name that would be an illegal folder', async () => {
    // A chat called "Urlaub: Italien?" would be rejected outright by Windows.
    await writeExport({
      chat: { chat: { id: 'c2', name: 'Urlaub: Italien?' }, messages: [] },
      targetDir: join(root, 'out'),
      formats: ['txt'],
      blobPathFor: () => undefined,
    })
    const dirs = await readdir(join(root, 'out'))
    expect(dirs[0]).not.toMatch(/[:?]/)
  })

  it('hard-links media rather than copying, so a large archive costs directory entries', async () => {
    const blob = await makeBlob('abc.pdf')
    const result = await writeExport({
      chat: chat([
        { id: 'm1', chatId: 'c1', ts: 1, media: { id: 'me1', filename: 'Rechnung.pdf' } },
      ]),
      targetDir: join(root, 'out'),
      formats: ['txt'],
      blobPathFor: () => blob,
    })

    expect(result.mediaLinked).toBe(1)
    expect(result.mediaCopied).toBe(0)
    const linked = await stat(join(root, 'out', 'Familie Müller', 'media', 'Rechnung.pdf'))
    expect(linked.nlink).toBeGreaterThan(1)
  })

  it('names the media it could not resolve instead of failing the whole export', async () => {
    const result = await writeExport({
      chat: chat([{ id: 'm1', chatId: 'c1', ts: 1, media: { id: 'weg' } }]),
      targetDir: join(root, 'out'),
      formats: ['txt'],
      blobPathFor: () => undefined,
    })
    expect(result.mediaMissing).toEqual(['weg'])
    expect(result.files).toHaveLength(1)
  })

  it('exports only what is newer on an incremental run', async () => {
    const full = chat([
      { id: 'm1', chatId: 'c1', ts: 1000, body: 'alt' },
      { id: 'm2', chatId: 'c1', ts: 2000, body: 'neu' },
    ])
    const result = await writeExport({
      chat: full,
      targetDir: join(root, 'out'),
      formats: ['txt'],
      blobPathFor: () => undefined,
      since: 1500,
    })

    expect(result.messages).toBe(1)
    const txt = await readFile(join(root, 'out', 'Familie Müller', 'Familie Müller.txt'), 'utf8')
    expect(txt).toContain('neu')
    expect(txt).not.toContain('alt')
  })

  it('links media relatively in the HTML, so folder and file travel together', async () => {
    const blob = await makeBlob('x.jpg')
    await writeExport({
      chat: chat([{ id: 'm1', chatId: 'c1', ts: 1, media: { id: 'me1', filename: 'Bild.jpg' } }]),
      targetDir: join(root, 'out'),
      formats: ['html'],
      blobPathFor: () => blob,
    })
    const html = await readFile(join(root, 'out', 'Familie Müller', 'Familie Müller.html'), 'utf8')
    expect(html).toContain('href="media/Bild.jpg"')
  })
})

describe('incremental state', () => {
  it('treats a missing state file as a first run rather than an error', async () => {
    expect(await readExportState(join(root, 'nope.json'))).toEqual({ lastTsByChat: {} })
  })

  it('round-trips', async () => {
    const file = join(root, 'state.json')
    await writeExportState(file, { lastTsByChat: { c1: 1234 } })
    expect(await readExportState(file)).toEqual({ lastTsByChat: { c1: 1234 } })
  })

  it('reports the newest timestamp to record after a run', () => {
    expect(
      newestTs(
        chat([
          { id: 'a', chatId: 'c1', ts: 10 },
          { id: 'b', chatId: 'c1', ts: 90 },
        ]),
      ),
    ).toBe(90)
    expect(newestTs(chat([]))).toBeUndefined()
  })
})
