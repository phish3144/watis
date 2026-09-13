import { mkdirSync, writeFileSync, copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { APP_SLUG } from '@shared/app-identity'
import { desktopEntry, executablePath } from '../platform/linux'
import { resourcePath } from './resources'
import { log } from './logging'

/**
 * Makes an AppImage behave like something that was installed.
 *
 * An AppImage is one executable file. That is what makes it work without a package manager and
 * without root — and it also means the desktop knows nothing about it: no entry in the
 * application grid, no icon, nothing when you search for it, and a generic cogwheel in the dock
 * while it runs. "Portable" and "properly installed" are not supposed to be a choice.
 *
 * So the application registers itself, into the user's own home directory, using the freedesktop
 * locations every desktop reads:
 *
 *   ~/.local/share/applications/watis.desktop        the menu entry
 *   ~/.local/share/icons/hicolor/512x512/apps/…      the icon that entry names
 *
 * Nothing outside $HOME, nothing needing elevation, and removing the AppImage plus these two
 * files removes the application completely.
 *
 * Only for AppImages. A .deb would have shipped these itself, and writing them again from inside
 * would fight the package manager over files it owns.
 */

const applicationsDir = (): string => join(homedir(), '.local', 'share', 'applications')
const iconDir = (): string =>
  join(homedir(), '.local', 'share', 'icons', 'hicolor', '512x512', 'apps')

export interface IntegrationResult {
  /** False when there was nothing to do — not an AppImage, or not Linux. */
  applicable: boolean
  /** True when a file was created or refreshed on this run. */
  changed: boolean
  reason?: string
}

/**
 * Writes the entry if it is missing or points somewhere else.
 *
 * Rewriting on every start would be wasteful; never rewriting would leave a stale Exec behind
 * after the AppImage is moved or renamed — and a menu entry that launches nothing is worse than
 * no menu entry. So the file is compared, and written when it disagrees.
 */
export function integrateAppImage(): IntegrationResult {
  if (process.platform !== 'linux') return { applicable: false, changed: false }
  if (!process.env.APPIMAGE) {
    return { applicable: false, changed: false, reason: 'not running from an AppImage' }
  }

  try {
    const entry = desktopEntry({ minimised: false, forAutostart: false })
    const target = join(applicationsDir(), `${APP_SLUG}.desktop`)
    const current = existsSync(target) ? readFileSync(target, 'utf8') : ''

    const icon = join(iconDir(), `${APP_SLUG}.png`)
    // The application icon, not the tray icon: a menu entry shows the app, and a 32px status
    // glyph scaled to 512 looks exactly as bad as that sounds.
    const source = resourcePath('icons', 'app-512.png')

    let changed = false
    if (current !== entry) {
      mkdirSync(applicationsDir(), { recursive: true })
      writeFileSync(target, entry, 'utf8')
      changed = true
      log.info(`desktop entry written for ${executablePath()}`)
    }
    if (!existsSync(icon) && existsSync(source)) {
      mkdirSync(iconDir(), { recursive: true })
      copyFileSync(source, icon)
      changed = true
    }
    return { applicable: true, changed }
  } catch (error: unknown) {
    // Never fatal. A missing menu entry is a nuisance; failing to start over one is not
    // acceptable, and a read-only home directory is a real situation.
    log.warn(`desktop integration failed: ${String(error)}`)
    return { applicable: true, changed: false, reason: String(error) }
  }
}

/** Removes what integrateAppImage() wrote. Offered in settings, so uninstalling is complete. */
export function removeIntegration(): void {
  if (process.platform !== 'linux') return
  for (const file of [
    join(applicationsDir(), `${APP_SLUG}.desktop`),
    join(iconDir(), `${APP_SLUG}.png`),
    join(homedir(), '.config', 'autostart', `${APP_SLUG}.desktop`),
  ]) {
    try {
      rmSync(file, { force: true })
    } catch {
      // Best effort: a file that will not go is reported by its continued presence, not a throw.
    }
  }
}
