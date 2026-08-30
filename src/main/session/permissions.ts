import type { Session, WebContents } from 'electron'
import { WA_URL } from '@shared/app-identity'
import { log } from '../logging'

/**
 * Default-deny for both handlers.
 *
 * Both are needed. WhatsApp calls the CHECK handler synchronously for `Notification.permission`
 * and `navigator.permissions.query`, and it must return a boolean — a missing handler or an
 * undefined return denies, and WhatsApp then misbehaves quietly instead of asking.
 *
 * The trap: some CHECK calls arrive with an EMPTY requestingOrigin. Measured on Electron 44 for
 * `media`, `geolocation` and an undocumented `web-app-installation` during page load. A handler
 * that insists on an origin match therefore silently denies microphone and camera access. The
 * origin is resolved from the calling WebContents when the argument is empty.
 */

// setPermissionRequestHandler and setPermissionCheckHandler take different permission unions,
// so they get separate allowlists rather than one shared constant.
const ALLOWED_REQUESTS = new Set([
  'notifications',
  'media',
  'clipboard-sanitized-write',
  'fullscreen',
])

const ALLOWED_CHECKS = new Set([
  'notifications',
  'media',
  'clipboard-sanitized-write',
  'fullscreen',
])

const WA_ORIGIN = new URL(WA_URL).origin

function originOf(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

/** Falls back to the calling WebContents, because the origin argument is sometimes empty. */
function resolveOrigin(
  contents: WebContents | null,
  ...candidates: (string | undefined)[]
): string | undefined {
  for (const candidate of candidates) {
    const origin = originOf(candidate)
    if (origin) return origin
  }
  return originOf(contents?.getURL())
}

/**
 * These handlers are installed on the `persist:wa` partition, which hosts exactly one site. So
 * when no origin can be resolved at all — measured on Electron 44 during page load, where both
 * the origin argument and the WebContents URL are still empty — a MAIN-FRAME request on this
 * session can only be WhatsApp itself. Sub-frames stay denied: an embedded third party is the
 * one case where an unresolvable origin must not be trusted.
 */
function isWhatsAppFrame(origin: string | undefined, isMainFrame: boolean | undefined): boolean {
  if (origin) return origin === WA_ORIGIN
  return isMainFrame === true
}

export function installPermissionHandlers(session: Session): void {
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin = resolveOrigin(contents, details.requestingUrl)
    const granted = isWhatsAppFrame(origin, details.isMainFrame) && ALLOWED_REQUESTS.has(permission)
    if (!granted) log.info(`permission request denied: ${permission} from ${origin ?? '<unknown>'}`)
    callback(granted)
  })

  session.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    const origin = resolveOrigin(contents, requestingOrigin, details.requestingUrl)
    const granted = isWhatsAppFrame(origin, details.isMainFrame) && ALLOWED_CHECKS.has(permission)
    if (!granted) log.debug(`permission check denied: ${permission} from ${origin ?? '<unknown>'}`)
    return granted
  })

  // Nothing in this project talks to a device or to anything but WhatsApp and GitHub Releases.
  session.setDevicePermissionHandler(() => false)
}
