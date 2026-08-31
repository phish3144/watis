import { describe, expect, it } from 'vitest'
import {
  classify,
  extractPlainText,
  joinLines,
  meanConfidence,
} from '../../src/workers/content-index/engine'

describe('classify', () => {
  it('puts documents ahead of images', () => {
    // A PDF usually carries more searchable text than a photo does.
    const pdf = classify('application/pdf', 1000)
    const image = classify('image/jpeg', 1000)
    expect(pdf).toMatchObject({ source: 'pdf' })
    expect(image).toMatchObject({ source: 'ocr' })
    expect('priority' in pdf && 'priority' in image && pdf.priority > image.priority).toBe(true)
  })

  it('routes audio to transcription', () => {
    expect(classify('audio/ogg', 1000)).toMatchObject({ source: 'transcript' })
  })

  it('reads text files directly', () => {
    expect(classify('text/plain', 100)).toMatchObject({ source: 'text' })
    expect(classify(null, 100, 'notizen.md')).toMatchObject({ source: 'text' })
  })

  it('skips stickers', () => {
    expect(classify('image/webp', 1000)).toEqual({ skip: 'sticker or webp' })
  })

  it('skips anything too large to be worth reading', () => {
    const result = classify('video/mp4', 300 * 1024 * 1024)
    expect('skip' in result && result.skip).toContain('200 MB')
  })

  it('skips a type no engine handles, naming it', () => {
    const result = classify('application/x-tar', 100)
    expect(result).toEqual({ skip: 'no engine for application/x-tar' })
  })

  it('falls back to the filename when the mime type is missing', () => {
    expect(classify(null, 100, 'Rechnung.PDF')).toMatchObject({ source: 'pdf' })
  })
})

describe('extractPlainText', () => {
  it('splits into lines and keeps the text', () => {
    const out = extractPlainText('eins\nzwei')
    expect(out.text).toBe('eins\nzwei')
    expect(out.lines.map((l) => l.text)).toEqual(['eins', 'zwei'])
  })

  it('bounds an enormous file rather than storing it whole', () => {
    const out = extractPlainText('a'.repeat(100), 10)
    expect(Buffer.byteLength(out.text)).toBe(10)
  })

  it('handles CRLF', () => {
    expect(extractPlainText('a\r\nb').lines.map((l) => l.text)).toEqual(['a', 'b'])
  })
})

describe('joinLines', () => {
  it('drops empty lines and trims', () => {
    expect(joinLines([{ text: '  a ' }, { text: '   ' }, { text: 'b' }])).toBe('a\nb')
  })
})

describe('meanConfidence', () => {
  it('averages what the engine reported', () => {
    expect(
      meanConfidence([
        { text: 'a', confidence: 0.8 },
        { text: 'b', confidence: 0.6 },
      ]),
    ).toBeCloseTo(0.7)
  })

  it('is undefined when nothing reported a confidence', () => {
    expect(meanConfidence([{ text: 'a' }])).toBeUndefined()
  })
})
