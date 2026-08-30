import type { Session } from 'electron'
import { WA_URL } from '@shared/app-identity'
import { log } from '../logging'

/**
 * Default-deny for both handlers.
 *
 * Both are needed: WhatsApp calls the CHECK handler synchronously for some features, and if it
 * is absent Electron denies by default and WhatsApp misbehaves quietly rather than asking. The
 * two APIs also take different permission unions, so they get separate allowlists instead of one
 * shared constant.
 */

// setPermissionRequestHandler
const ALLOWED_REQUESTS = new Set([
  'notifications',
  'media',
  'clipboard-sanitized-write',
  'fullscreen',
])

// setPermissionCheckHandler
const ALLOWED_CHECKS = new Set([
  'notifications',
  'media',
  'clipboard-sanitized-write',
  'fullscreen',
])

function isWhatsApp(url: string): boolean {
  try {
    return new URL(url).origin === new URL(WA_URL).origin
  } catch {
    return false
  }
}

export function installPermissionHandlers(session: Session): void {
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    const origin = details.requestingUrl || contents?.getURL() || ''
    const granted = isWhatsApp(origin) && ALLOWED_REQUESTS.has(permission)
    if (!granted) log.info(`permission request denied: ${permission} from ${origin}`)
    callback(granted)
  })

  session.setPermissionCheckHandler((_contents, permission, requestingOrigin) => {
    const granted = isWhatsApp(requestingOrigin) && ALLOWED_CHECKS.has(permission)
    if (!granted) log.debug(`permission check denied: ${permission} from ${requestingOrigin}`)
    return granted
  })

  // Nothing in this project opens a port or speaks to anything but WhatsApp and, for the
  // updater, GitHub Releases. Refuse device access outright rather than relying on defaults.
  session.setDevicePermissionHandler(() => false)
}
