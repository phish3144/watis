import type { Session } from 'electron'
import { log } from '../logging'

/**
 * The spell checker (PLAN.md Phase 1), off unless the user turns it on.
 *
 * The reason it is off by default is not taste. On Windows, Chromium fetches hunspell dictionaries
 * from a Google host the first time a language is set — outbound traffic to somewhere the project's
 * network rule does not allow (CLAUDE.md, "Datenschutz und Netz"). Turning it on is therefore an
 * explicit user action, the same shape of exception the rule already makes for model downloads, and
 * the settings page says where the file comes from rather than leaving it to be discovered in a
 * packet capture.
 *
 * macOS uses the operating system's own speller and downloads nothing, so none of this applies
 * there — which is exactly why it must not be decided at the call site.
 */
export function applySpellcheck(session: Session, languages: readonly string[]): void {
  const wanted = languages.filter((tag) => tag.trim() !== '')

  try {
    if (wanted.length === 0) {
      session.setSpellCheckerEnabled(false)
      return
    }

    session.setSpellCheckerEnabled(true)
    if (process.platform === 'darwin') {
      // The macOS speller follows the system languages and rejects an explicit list.
      log.info('spellcheck on, using the system dictionaries')
      return
    }
    session.setSpellCheckerLanguages([...wanted])
    log.info(`spellcheck on for ${wanted.join(', ')} (dictionaries are fetched by Chromium)`)
  } catch (error: unknown) {
    // An unsupported language tag throws. The setting is the user's, so it is reported rather than
    // silently corrected — a speller quietly checking the wrong language is worse than none.
    log.warn(`could not apply spellcheck languages ${wanted.join(', ')}: ${String(error)}`)
  }
}

/** What the settings page offers. Chromium supports far more; these are the ones worth listing. */
export function availableLanguages(session: Session): string[] {
  try {
    return [...session.availableSpellCheckerLanguages]
  } catch {
    return []
  }
}
