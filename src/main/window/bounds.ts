import { screen } from 'electron'
import type { Rectangle } from 'electron'
import { log } from '../logging'

/**
 * Window placement, persisted across restarts.
 *
 * Two constraints shape this module, and both were learned the hard way:
 *
 *  1. electron-store v11 is pure ESM while the main bundle is CommonJS (sandboxed preloads
 *     cannot use ESM, so the whole main/preload side stays CJS). A plain `require` of it throws
 *     at module-evaluation time. It is therefore loaded with a dynamic import.
 *  2. Nothing here may run at module scope. Module bodies are evaluated during the import phase,
 *     which happens BEFORE the first statement of the entry point — so a store created at module
 *     scope would read app.getPath('userData') before configurePaths() has redirected it, and
 *     write the file into the roaming profile this project exists to avoid.
 */

interface BoundsState {
  bounds?: Rectangle
  maximised?: boolean
}

interface StoreLike {
  get<K extends keyof BoundsState>(key: K): BoundsState[K]
  set<K extends keyof BoundsState>(key: K, value: NonNullable<BoundsState[K]>): void
}

const DEFAULT_WIDTH = 1280
const DEFAULT_HEIGHT = 860

export const MINIMUM_SIZE = { minWidth: 940, minHeight: 600 }

let store: StoreLike | undefined

/** Call once after app.whenReady() and after configurePaths(), before the window is created. */
export async function initWindowState(): Promise<void> {
  if (store) return
  try {
    const { default: Store } = await import('electron-store')
    store = new Store<BoundsState>({ name: 'window-state' })
  } catch (error: unknown) {
    // Losing the remembered geometry is a cosmetic failure; it must never stop the app.
    log.warn(`window state unavailable, falling back to defaults: ${String(error)}`)
  }
}

/** Keeps a saved window from opening off-screen after a monitor is unplugged. */
function isVisibleOnSomeDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    )
  })
}

function centredDefault(): Rectangle {
  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.min(DEFAULT_WIDTH, workArea.width)
  const height = Math.min(DEFAULT_HEIGHT, workArea.height)
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  }
}

export function restoreBounds(): { bounds: Rectangle; maximised: boolean } {
  const saved = store?.get('bounds')
  const maximised = store?.get('maximised') ?? false
  if (saved && isVisibleOnSomeDisplay(saved)) return { bounds: saved, maximised }
  return { bounds: centredDefault(), maximised: false }
}

export function persistBounds(bounds: Rectangle, maximised: boolean): void {
  // Only the restored (unmaximised) geometry is stored, otherwise un-maximising loses the size.
  if (!maximised) store?.set('bounds', bounds)
  store?.set('maximised', maximised)
}
