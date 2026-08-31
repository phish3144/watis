import { canStillReadMessages, type HealthState } from '@shared/health/degraded'
import { t } from '../i18n'

/**
 * One line above everything else, saying what is broken and what still works (PLAN.md Phase 9).
 *
 * It is deliberately not dismissible: every fault it shows is either self-clearing or something
 * the user has to act on, and a banner you can dismiss for a condition that persists is worse
 * than none — it trains people to close it without reading.
 */
export function HealthBanner({
  state,
}: {
  state: HealthState | undefined
}): React.JSX.Element | null {
  if (!state?.banner) return null

  const broken = state.severity === 'broken'
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mb-3 shrink-0 rounded-lg px-3 py-2 text-xs leading-snug ${
        broken ? 'bg-red-950/70 text-red-200' : 'bg-amber-950/60 text-amber-200'
      }`}
    >
      <p>{t(state.banner)}</p>
      {canStillReadMessages(state) && (
        <p className="mt-0.5 opacity-70">{t('health.stillReadable')}</p>
      )}
    </div>
  )
}
