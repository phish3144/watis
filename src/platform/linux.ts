import { app, nativeImage, shell } from 'electron'
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Platform } from './index'
import { resourcePath } from '../main/resources'
import { APP_SLUG, PRODUCT_NAME } from '@shared/app-identity'
import { log } from '../main/logging'

/**
 * Linux implementation.
 *
 * Everything here stays inside the user's own home directory. No /usr, no /etc, no systemd unit,
 * no package manager — the same rule the Windows side follows for HKLM, for the same reason: the
 * application must be installable and removable by somebody with no administrative rights.
 *
 * Freedesktop conventions do all the work, and they are all user-scoped by design:
 *   ~/.config/autostart/            launch at login
 *   ~/.local/share/applications/    the entry in the application menu
 *   ~/.local/share/icons/hicolor/   the icon that entry uses
 */

/** Where the executable actually lives — inside an AppImage that is not argv[0]. */
export function executablePath(): string {
  return process.env.APPIMAGE ?? process.execPath
}

const autostartDir = (): string => join(homedir(), '.config', 'autostart')
const autostartFile = (): string => join(autostartDir(), `${APP_SLUG}.desktop`)

/**
 * A desktop entry. The same shape serves autostart and the application menu; only the location
 * and the autostart-specific keys differ.
 */
export function desktopEntry(options: { minimised: boolean; forAutostart: boolean }): string {
  const exec = options.minimised ? `"${executablePath()}" --minimised` : `"${executablePath()}"`
  return [
    '[Desktop Entry]',
    'Type=Application',
    // PRODUCT_NAME, not DISPLAY_NAME: this is the application-menu entry, the Linux counterpart
    // of the Start Menu entry, and CLAUDE.md reserves the question mark for rendered UI text.
    `Name=${PRODUCT_NAME}`,
    'Comment=WhatsApp Web mit lokalem, durchsuchbarem Archiv',
    `Exec=${exec}`,
    `Icon=${APP_SLUG}`,
    'Terminal=false',
    'Categories=Network;InstantMessaging;',
    `StartupWMClass=${APP_SLUG}`,
    ...(options.forAutostart ? ['X-GNOME-Autostart-enabled=true'] : []),
    '',
  ].join('\n')
}

/**
 * Whether a tray icon will be seen.
 *
 * GNOME removed support for legacy tray icons in GNOME 3.26 and never brought it back. Electron
 * still creates a StatusNotifierItem successfully — the constructor does not fail and the icon is
 * not empty — there is simply no host listening, so nothing appears. `icon.isEmpty()`, which is
 * what the tray controller checks, cannot detect that.
 *
 * That matters because of close-to-tray: hiding the window into a tray nobody can see takes the
 * application away with no way back. So the environment is asked, and GNOME is assumed to have no
 * tray unless one of the extensions that restores it is installed — which is exactly what
 * announces itself by owning the StatusNotifierWatcher name on the session bus.
 *
 * Detection is by environment rather than by a DBus round trip: this is consulted while deciding
 * window behaviour, the main process may not block, and being wrong here costs a checkbox rather
 * than the session. It fails towards "no tray", which is the safe direction.
 */
export function trayIsReliableHere(env: NodeJS.ProcessEnv = process.env): boolean {
  const desktops = (env.XDG_CURRENT_DESKTOP ?? env.DESKTOP_SESSION ?? '').toLowerCase()
  if (desktops === '') return false
  const gnomeish = /gnome|unity|pantheon/.test(desktops)
  if (!gnomeish) return true
  // AppIndicator/KStatusNotifier extensions set this when they are running under GNOME.
  return env.WATIS_FORCE_TRAY === '1'
}

export function createLinuxPlatform(): Platform {
  return {
    id: 'linux',

    setUnreadBadge(count, _window) {
      // The Unity launcher API, which GNOME's Dash-to-Dock and KDE's task manager also implement.
      // Where nothing implements it this is a silent no-op, which is the right outcome.
      app.setBadgeCount(count > 0 ? count : 0)
    },

    setAutostart({ enabled, minimised }) {
      // Not app.setLoginItemSettings: on Linux Electron writes a desktop entry whose Exec points
      // at process.execPath, which inside an AppImage is the unpacked binary in a temporary mount
      // that no longer exists at the next login. The entry is written here so it points at the
      // AppImage itself.
      try {
        if (!enabled) {
          rmSync(autostartFile(), { force: true })
          return
        }
        mkdirSync(autostartDir(), { recursive: true })
        writeFileSync(autostartFile(), desktopEntry({ minimised, forAutostart: true }), 'utf8')
      } catch (error: unknown) {
        log.warn(`could not change autostart: ${String(error)}`)
      }
    },

    isAutostartEnabled() {
      return existsSync(autostartFile())
    },

    showItemInFolder(absolutePath) {
      shell.showItemInFolder(absolutePath)
    },

    sidecarPath(binaryName) {
      return resourcePath('sidecars', binaryName)
    },

    registerProtocolHandler(scheme) {
      // Writes a desktop entry under ~/.local/share/applications and updates the user's
      // mimeapps.list. User scope only.
      return app.setAsDefaultProtocolClient(scheme)
    },

    async isOnAcPower() {
      const { powerMonitor } = await import('electron')
      return !powerMonitor.isOnBatteryPower()
    },

    trayIcon() {
      // A plain PNG: Linux status icons are not template images, and 32px is what the common
      // panels ask for.
      return nativeImage.createFromPath(resourcePath('tray', 'tray-32.png'))
    },

    trayIsReliable() {
      return trayIsReliableHere()
    },
  }
}
