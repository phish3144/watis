import { app, nativeImage, shell } from 'electron'
import type { Platform } from './index'
import { resourcePath } from '../main/resources'

/**
 * Windows implementation.
 *
 * Deliberately absent: any HKLM write, service, driver or listening port. Autostart is a plain
 * HKCU Run value written by Electron, which needs no elevation. The Start Menu shortcut that
 * Windows requires for toasts is created by the installer and by Electron's own toast
 * activator — that is the one allowed write outside %LOCALAPPDATA% (ADR 0004 B).
 */
export function createWindowsPlatform(): Platform {
  return {
    id: 'win32',

    setUnreadBadge(count, window) {
      // app.setBadgeCount is '@platform linux,darwin' — on Windows it silently does nothing.
      // The overlay icon is the Windows equivalent. nativeImage decodes only PNG and JPEG (an
      // SVG yields an empty image with no error), so the digits are pre-rendered PNGs shipped
      // with the build rather than drawn at runtime — that also avoids a second renderer
      // process existing purely to paint a number. The assets arrive with phase 1; until then
      // a missing file simply clears the overlay.
      if (count <= 0) {
        window.setOverlayIcon(null, '')
        return
      }
      const capped = count > 9 ? '9plus' : String(count)
      const icon = nativeImage.createFromPath(resourcePath('badges', `${capped}.png`))
      window.setOverlayIcon(icon.isEmpty() ? null : icon, `${count} ungelesene Nachrichten`)
    },

    setAutostart({ enabled, minimised }) {
      // Electron 44 removed openAsHidden, so "start minimised" travels as an argv flag that
      // main/index.ts checks on startup.
      app.setLoginItemSettings({
        openAtLogin: enabled,
        args: minimised ? ['--minimised'] : [],
      })
    },

    isAutostartEnabled() {
      return app.getLoginItemSettings().openAtLogin
    },

    showItemInFolder(absolutePath) {
      shell.showItemInFolder(absolutePath)
    },

    sidecarPath(binaryName) {
      const exe = binaryName.endsWith('.exe') ? binaryName : `${binaryName}.exe`
      return resourcePath('sidecars', exe)
    },

    registerProtocolHandler(scheme) {
      // Writes HKCU only.
      return app.setAsDefaultProtocolClient(scheme)
    },

    async isOnAcPower() {
      const { powerMonitor } = await import('electron')
      return !powerMonitor.isOnBatteryPower()
    },

    trayIcon() {
      return nativeImage.createFromPath(resourcePath('tray', 'tray.ico'))
    },
  }
}
