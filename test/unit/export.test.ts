import { describe, expect, it } from 'vitest'
import {
  buildIntegrityReport,
  formatTimestamp,
  toHtml,
  toJson,
  toText,
  type ExportChat,
} from '../../src/workers/archive/export'

const at = (y: number, m: number, d: number, h: number, min: number): number =>
  Math.floor(new Date(y, m - 1, d, h, min).getTime() / 1000)

const chat = (messages: ExportChat['messages']): ExportChat => ({
  chat: { id: 'c1', name: 'Familie Müller', kind: 'group' },
  messages,
})

describe('formatTimestamp', () => {
  it('matches the shape WhatsApp exports', () => {
    expect(formatTimestamp(at(2026, 3, 7, 9, 5))).toBe('07.03.26, 09:05')
  })

  it('pads a two-digit year across the century', () => {
    expect(formatTimestamp(at(2007, 12, 31, 23, 59))).toBe('31.12.07, 23:59')
  })
})

describe('toText', () => {
  it('writes [dd.mm.yy, hh:mm] Name: Text', () => {
    const out = toText(
      chat([
        { id: 'm1', chatId: 'c1', ts: at(2026, 1, 2, 8, 30), body: 'Moin', senderName: 'Anna' },
        { id: 'm2', chatId: 'c1', ts: at(2026, 1, 2, 8, 31), body: 'Auch moin', fromMe: true },
      ]),
    )
    expect(out).toBe('[02.01.26, 08:30] Anna: Moin\n[02.01.26, 08:31] Du: Auch moin')
  })

  it('names an attachment when there is no text', () => {
    const out = toText(
      chat([
        {
          id: 'm1',
          chatId: 'c1',
          ts: at(2026, 1, 2, 8, 30),
          body: null,
          senderName: 'Anna',
          media: { id: 'me1', filename: 'Rechnung.pdf' },
        },
      ]),
    )
    expect(out).toContain('<Anhang: Rechnung.pdf>')
  })

  it('marks a revoked message rather than exporting an empty line', () => {
    const out = toText(
      chat([{ id: 'm1', chatId: 'c1', ts: at(2026, 1, 2, 8, 30), body: 'weg', revoked: true }]),
    )
    expect(out).toContain('Diese Nachricht wurde gelöscht.')
    expect(out).not.toContain('weg')
  })

  it('falls back to the jid when no name is known', () => {
    const out = toText(
      chat([{ id: 'm1', chatId: 'c1', ts: at(2026, 1, 2, 8, 30), body: 'x', senderJid: 'a@s' }]),
    )
    expect(out).toContain('] a@s: x')
  })
})

describe('toJson', () => {
  it('parses raw_json back into structure so nothing is double-encoded', () => {
    const json = JSON.parse(
      toJson(
        chat([
          {
            id: 'm1',
            chatId: 'c1',
            ts: 1,
            body: 'hi',
            rawJson: '{"key":"value"}',
          },
        ]),
      ),
    ) as { messages: { raw: unknown }[] }
    expect(json.messages[0]?.raw).toEqual({ key: 'value' })
  })

  it('keeps an unparsable raw payload verbatim instead of dropping it', () => {
    const json = JSON.parse(
      toJson(chat([{ id: 'm1', chatId: 'c1', ts: 1, rawJson: 'not json' }])),
    ) as { messages: { raw: unknown }[] }
    expect(json.messages[0]?.raw).toBe('not json')
  })
})

describe('toHtml', () => {
  it('escapes message text', () => {
    const html = toHtml(
      chat([{ id: 'm1', chatId: 'c1', ts: 1, body: '<script>alert(1)</script>' }]),
    )
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('&lt;script&gt;')
  })

  it('escapes the chat name in the title', () => {
    const html = toHtml({ chat: { id: 'c1', name: '<b>Bold</b>' }, messages: [] })
    expect(html).toContain('&lt;b&gt;Bold&lt;/b&gt;')
  })

  it('links media relatively so the folder can be moved as a unit', () => {
    const html = toHtml(
      chat([
        {
          id: 'm1',
          chatId: 'c1',
          ts: 1,
          media: { id: 'me1', filename: 'Bild.jpg' },
        },
      ]),
    )
    expect(html).toContain('href="media/Bild.jpg"')
    expect(html).not.toContain('file://')
  })

  it('keeps line breaks inside a message', () => {
    const html = toHtml(chat([{ id: 'm1', chatId: 'c1', ts: 1, body: 'a\nb' }]))
    expect(html).toContain('a<br>b')
  })

  it('contains no script and no network reference', () => {
    const html = toHtml(chat([{ id: 'm1', chatId: 'c1', ts: 1, body: 'x' }]))
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/https?:\/\//)
  })
})

describe('buildIntegrityReport', () => {
  it('passes when every finished blob is present', () => {
    const report = buildIntegrityReport({
      chats: 2,
      messages: 10,
      media: [{ id: 'me1', sha256: 'aa', status: 'done' }],
      blobExists: () => true,
    })
    expect(report.ok).toBe(true)
    expect(report).toMatchObject({ chats: 2, messages: 10, media: 1 })
  })

  it('names the media whose blob is gone', () => {
    const report = buildIntegrityReport({
      chats: 1,
      messages: 1,
      media: [
        { id: 'here', sha256: 'aa', status: 'done' },
        { id: 'gone', sha256: 'bb', status: 'done' },
      ],
      blobExists: (r) => r.id === 'here',
    })
    expect(report.missingBlobs).toEqual(['gone'])
    expect(report.ok).toBe(false)
  })

  it('separates unhashed rows from missing blobs', () => {
    // Without a hash there is no address to look up, which is a different fault to a lost file.
    const report = buildIntegrityReport({
      chats: 1,
      messages: 1,
      media: [{ id: 'nohash', status: 'done' }],
      blobExists: () => false,
    })
    expect(report.unhashed).toEqual(['nohash'])
    expect(report.missingBlobs).toEqual([])
  })

  it('ignores media that was never meant to be downloaded', () => {
    const report = buildIntegrityReport({
      chats: 1,
      messages: 1,
      media: [
        { id: 'skipped', status: 'skipped' },
        { id: 'pending', status: 'pending' },
      ],
      blobExists: () => false,
    })
    expect(report.ok).toBe(true)
  })
})
