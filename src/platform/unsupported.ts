import { join } from 'node:path'
import { app, nativeImage } from 'electron'
import type { Platform } from './index'

/**
 * Linux and anything else. Not a release target, but the app has to start there so the test
 * suite and CI can run. Every method is a safe no-op rather than a throw.
 */
export function createUnsupportedPlatform(): Platform {
  return {
    id: 'unsupported',
    setUnreadBadge(count, _window) {
      app.setBadgeCount(count > 0 ? count : 0)
    },
    setAutostart() {
      // No-op: not a release target.
    },
    isAutostartEnabled() {
      return false
    },
    showItemInFolder() {
      // No-op: not a release target.
    },
    sidecarPath(binaryName) {
      return join(app.getAppPath(), 'resources', 'sidecars', binaryName)
    },
    registerProtocolHandler() {
      return false
    },
    isOnAcPower() {
      return Promise.resolve(true)
    },
    trayIcon() {
      return nativeImage.createEmpty()
    },
  }
}
