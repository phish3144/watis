import { join } from 'node:path'
import { app } from 'electron'

/**
 * Resolves a bundled resource in both dev and packaged mode.
 *
 * In a packaged app these live under process.resourcesPath because electron-builder copies
 * `resources/` there via extraResources; in dev they sit in the repo.
 */
export function resourcePath(...segments: string[]): string {
  return app.isPackaged
    ? join(process.resourcesPath, ...segments)
    : join(app.getAppPath(), 'resources', ...segments)
}
