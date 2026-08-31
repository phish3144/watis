import { desktopCapturer, type DesktopCapturerSource, type Session } from 'electron'
import { log } from '../logging'

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

/**
 * Installs the picker on a session (PLAN.md Phase 1).
 *
 * Electron hands over the whole `desktopCapturer` list and expects one entry back. Without a
 * handler, Chromium's own picker never appears in an Electron app and screen sharing simply fails
 * with no explanation — which looks like a broken feature rather than a missing one.
 *
 * `useSystemPicker` is preferred where the OS has one (Windows 11's own dialog, macOS's
 * ScreenCaptureKit sheet): the native chooser is the one people already know, and it does not need
 * us to hold a list of thumbnails in memory. The in-app dialog is the fallback.
 */
export function installDisplayPicker(
  session: Session,
  ask: (sources: PickerSource[]) => Promise<PickerResult>,
): void {
  session.setDisplayMediaRequestHandler(
    (_request, callback) => {
      void (async () => {
        try {
          const raw = await desktopCapturer.getSources({
            types: ['screen', 'window'],
            thumbnailSize: { width: 320, height: 180 },
            fetchWindowIcons: false,
          })
          const choice = await ask(toPickerSources(raw))
          if ('cancelled' in choice) {
            // An empty callback is how Electron is told the user said no. Anything else would
            // start a share nobody agreed to.
            callback({})
            return
          }
          const picked = raw.find((s) => s.id === choice.source.id)
          callback(picked ? { video: picked } : {})
        } catch (error: unknown) {
          log.warn(`display picker failed: ${String(error)}`)
          callback({})
        }
      })()
    },
    // Audio is never captured. Screen sharing in WhatsApp carries the microphone, which the page
    // requests separately and the permission handler decides on — capturing the system's output
    // on top of that is not something anybody asked for.
    { useSystemPicker: true },
  )
}
