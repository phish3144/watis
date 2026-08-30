import { app, nativeImage, shell } from 'electron'
import type { Platform } from './index'
import { resourcePath } from '../main/resources'

/**
 * macOS implementation.
 *
 * Two documented stubs, both because the build is unsigned:
 *  - setAutostart is a no-op. app.setLoginItemSettings needs a signed and notarised app on
 *    macOS; in an unsigned build it fails silently, which would look like a bug rather than a
 *    known limitation. Revisit when notarisation reaches CI.
 *  - registerProtocolHandler is likewise unreliable unsigned, so it reports failure honestly
 *    instead of claiming success.
 */
export function createMacPlatform(): Platform {
  return {
    id: 'darwin',

    setUnreadBadge(count, _window) {
      app.setBadgeCount(count > 0 ? count : 0)
    },

    setAutostart() {
      // Documented stub: app.setLoginItemSettings needs a signed and notarised app on macOS and
      // fails silently otherwise, which would read as a bug rather than a known limitation.
      // Revisit when notarisation reaches CI.
    },

    isAutostartEnabled() {
      return app.getLoginItemSettings().openAtLogin
    },

    showItemInFolder(absolutePath) {
      shell.showItemInFolder(absolutePath)
    },

    sidecarPath(binaryName) {
      return resourcePath('sidecars', binaryName)
    },

    registerProtocolHandler() {
      // Stub: unreliable without signing. Report failure rather than pretend.
      return false
    },

    async isOnAcPower() {
      const { powerMonitor } = await import('electron')
      return !powerMonitor.isOnBatteryPower()
    },

    trayIcon() {
      // macOS wants a template image so it adapts to light and dark menu bars.
      const icon = nativeImage.createFromPath(resourcePath('tray', 'trayTemplate.png'))
      icon.setTemplateImage(true)
      return icon
    },
  }
}
