import type { DesktopCapturerSource } from 'electron'

/**
 * Source list for the screen-share picker (PLAN.md Phase 1, criticism #16).
 *
 * Electron has no picker of its own — `setDisplayMediaRequestHandler` hands us the sources and
 * expects a choice back — so the ordering and labelling below is the whole user experience.
 *
 * Sorting and naming are pure functions so they can be tested; the capture call itself is not.
 */

export interface PickerSource {
  id: string
  name: string
  kind: 'screen' | 'window'
  thumbnailDataUrl?: string | undefined
}

/**
 * Screens first, then windows by name. A person sharing their screen nearly always wants a screen,
 * and hunting for it below thirty browser tabs is the complaint the official client earns.
 */
export function toPickerSources(sources: readonly DesktopCapturerSource[]): PickerSource[] {
  const mapped = sources.map((source): PickerSource => {
    const kind = source.id.startsWith('screen:') ? 'screen' : 'window'
    const thumbnail = source.thumbnail.isEmpty() ? undefined : source.thumbnail.toDataURL()
    return {
      id: source.id,
      name: labelFor(source.name, kind),
      kind,
      ...(thumbnail ? { thumbnailDataUrl: thumbnail } : {}),
    }
  })

  return mapped.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'screen' ? -1 : 1
    return a.name.localeCompare(b.name, 'de')
  })
}

/** Electron names screens "Entire screen" or "Screen 1"; a bare number is not a label. */
export function labelFor(name: string, kind: 'screen' | 'window'): string {
  const trimmed = name.trim()
  if (kind === 'screen') {
    if (trimmed === '' || /^screen\s*\d*$/i.test(trimmed)) return 'Ganzer Bildschirm'
    return trimmed
  }
  return trimmed === '' ? 'Unbenanntes Fenster' : trimmed
}

/**
 * Refusing is a first-class answer. `setDisplayMediaRequestHandler` must be called back exactly
 * once, and dropping the callback leaves the page waiting forever on a permission prompt that
 * never resolves.
 */
export type PickerResult = { source: PickerSource } | { cancelled: true }
