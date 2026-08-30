import { describe, expect, it, vi } from 'vitest'

// The main process module imports `electron` for app.getName(); stub it so this stays a plain
// Node unit test.
vi.mock('electron', () => ({ app: { getName: () => 'watis', userAgentFallback: '' } }))

const { chromeUserAgent } = await import('../../src/main/user-agent')

describe('chromeUserAgent', () => {
  it('removes the Electron token', () => {
    const input =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) watis/0.0.0 Chrome/152.0.7977.54 Electron/44.0.0 Safari/537.36'
    const result = chromeUserAgent(input)
    expect(result).not.toContain('Electron')
    expect(result).not.toContain('watis/')
  })

  it('reduces the Chrome version to the frozen MAJOR.0.0.0 form real Chrome sends', () => {
    const input =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.54 Electron/44.0.0 Safari/537.36'
    expect(chromeUserAgent(input)).toContain('Chrome/152.0.0.0')
    expect(chromeUserAgent(input)).not.toContain('7977')
  })

  it('leaves the operating system token untouched', () => {
    // Faking the OS would be contradicted by Sec-CH-UA-Platform in the same request.
    const input =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.54 Electron/44.0.0 Safari/537.36'
    expect(chromeUserAgent(input)).toContain('Macintosh; Intel Mac OS X 10_15_7')
  })

  it('is idempotent', () => {
    const input =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.54 Electron/44.0.0 Safari/537.36'
    const once = chromeUserAgent(input)
    expect(chromeUserAgent(once)).toBe(once)
  })
})
