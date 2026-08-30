import type { Platform } from './index'
import { createWindowsPlatform } from './win32'
import { createMacPlatform } from './darwin'
import { createUnsupportedPlatform } from './unsupported'

let cached: Platform | undefined

/** The single entry point feature code uses. Never branch on process.platform elsewhere. */
export function platform(): Platform {
  if (cached) return cached
  cached =
    process.platform === 'win32'
      ? createWindowsPlatform()
      : process.platform === 'darwin'
        ? createMacPlatform()
        : createUnsupportedPlatform()
  return cached
}
