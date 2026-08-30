import { defaultSettings, parseSettings, type Settings, type SettingsPatch } from '@shared/settings'
import { log } from '../logging'

/**
 * Settings persistence. Only config.json lives here — it stays small, because everything large
 * (archive, blobs, session) has its own directory under %LOCALAPPDATA%\watis.
 *
 * electron-store is ESM-only and the main bundle is CommonJS, so it is loaded with a dynamic
 * import from inside a function — never at module scope, which would run during the import
 * phase and read userData before configurePaths() has redirected it.
 */

interface StoreLike {
  get(key: 'settings'): unknown
  set(key: 'settings', value: Settings): void
}

let store: StoreLike | undefined
let cached: Settings = defaultSettings
const listeners = new Set<(settings: Settings) => void>()

export async function initSettings(): Promise<Settings> {
  try {
    const { default: Store } = await import('electron-store')
    store = new Store({ name: 'config' })
    cached = parseSettings(store.get('settings'))
  } catch (error: unknown) {
    log.warn(`settings unavailable, using defaults: ${String(error)}`)
    cached = defaultSettings
  }
  return cached
}

export function settings(): Settings {
  return cached
}

export function updateSettings(patch: SettingsPatch): Settings {
  cached = parseSettings({ ...cached, ...patch })
  try {
    store?.set('settings', cached)
  } catch (error: unknown) {
    log.warn(`could not persist settings: ${String(error)}`)
  }
  for (const listener of listeners) listener(cached)
  return cached
}

export function onSettingsChanged(listener: (settings: Settings) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
