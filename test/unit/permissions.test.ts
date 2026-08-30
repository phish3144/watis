import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({}))
vi.mock('../../src/main/logging', () => ({
  log: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const { installPermissionHandlers } = await import('../../src/main/session/permissions')

type CheckHandler = (
  contents: { getURL(): string } | null,
  permission: string,
  requestingOrigin: string,
  details: { requestingUrl?: string; isMainFrame?: boolean },
) => boolean
type RequestHandler = (
  contents: { getURL(): string } | null,
  permission: string,
  callback: (granted: boolean) => void,
  details: { requestingUrl?: string; isMainFrame?: boolean },
) => void

function install(): { check: CheckHandler; request: RequestHandler } {
  let check: CheckHandler | undefined
  let request: RequestHandler | undefined
  const session = {
    setPermissionRequestHandler: (handler: RequestHandler) => (request = handler),
    setPermissionCheckHandler: (handler: CheckHandler) => (check = handler),
    setDevicePermissionHandler: () => undefined,
  }
  installPermissionHandlers(session as never)
  if (!check || !request) throw new Error('handlers were not installed')
  return { check, request }
}

const waContents = { getURL: () => 'https://web.whatsapp.com/' }

describe('permission handlers', () => {
  let check: CheckHandler
  let request: RequestHandler
  beforeEach(() => {
    ;({ check, request } = install())
  })

  it('grants the allowlisted permissions to WhatsApp', () => {
    for (const permission of [
      'notifications',
      'media',
      'clipboard-sanitized-write',
      'fullscreen',
    ]) {
      expect(check(waContents, permission, 'https://web.whatsapp.com', {})).toBe(true)
    }
  })

  it('grants an allowlisted main-frame permission when no origin can be resolved', () => {
    // Measured on Electron 44: during page load the CHECK handler is called for media,
    // geolocation and web-app-installation with an empty requestingOrigin AND an empty
    // WebContents URL. Requiring an origin match there silently denies microphone and camera.
    // These handlers sit on the persist:wa partition, which hosts one site, so a main frame
    // with no resolvable origin is WhatsApp.
    const loading = { getURL: () => '' }
    expect(check(loading, 'media', '', { isMainFrame: true })).toBe(true)
    expect(check(loading, 'notifications', '', { isMainFrame: true })).toBe(true)
  })

  it('denies an unresolvable origin in a sub-frame', () => {
    // An embedded third party is exactly the case where an empty origin must not be trusted.
    const loading = { getURL: () => '' }
    expect(check(loading, 'media', '', { isMainFrame: false })).toBe(false)
    expect(check(loading, 'media', '', {})).toBe(false)
  })

  it('still denies non-allowlisted permissions even from WhatsApp', () => {
    for (const permission of ['geolocation', 'web-app-installation', 'midi', 'idle-detection']) {
      expect(check(waContents, permission, 'https://web.whatsapp.com', {})).toBe(false)
    }
  })

  it('denies everything from any other origin', () => {
    const evil = { getURL: () => 'https://evil.example/' }
    expect(check(evil, 'media', 'https://evil.example', {})).toBe(false)
    expect(check(evil, 'notifications', '', {})).toBe(false)
  })

  it('denies when there is neither an origin nor a main frame', () => {
    expect(check(null, 'media', '', {})).toBe(false)
    expect(check(null, 'media', '', { isMainFrame: false })).toBe(false)
  })

  it('applies the same rules to the request handler', () => {
    const granted: boolean[] = []
    request(waContents, 'media', (g) => granted.push(g), {})
    request(waContents, 'geolocation', (g) => granted.push(g), {})
    request(null, 'media', (g) => granted.push(g), {})
    expect(granted).toEqual([true, false, false])
  })
})
