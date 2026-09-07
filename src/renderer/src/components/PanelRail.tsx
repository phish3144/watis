import { api, type UnreadCounts } from '../api'
import type { HealthState } from '@shared/health/degraded'

/**
 * The collapsed panel: a narrow strip down the right edge of the window.
 *
 * It exists because the panel used to collapse to nothing, leaving a keyboard shortcut as the only
 * way back in. The first person to run this application saw a plain WhatsApp window and asked
 * where the features were — which was a fair question, because there was nothing on screen to
 * suggest there were any.
 *
 * So the rail is never not there. It says what is behind it, and it carries the one or two signals
 * worth interrupting for: a fault, and unread messages.
 */
export function PanelRail({
  unread,
  health,
}: {
  unread: UnreadCounts
  health: HealthState | undefined
}): React.JSX.Element {
  const broken = health?.severity === 'broken'
  const degraded = health?.severity === 'degraded'

  return (
    <button
      type="button"
      onClick={() => {
        api().togglePanel()
      }}
      title="Archiv und Einstellungen öffnen (Strg + ,)"
      aria-label="Archiv und Einstellungen öffnen"
      className="flex h-screen w-full flex-col items-center gap-3 border-l border-wa-hairline bg-wa-panel py-3 text-wa-muted hover:bg-wa-surface hover:text-wa-text"
    >
      <span aria-hidden="true" className="text-xs leading-none">
        ‹
      </span>

      {unread.unread > 0 && (
        <span className="rounded-full bg-wa-accent px-1 py-0.5 text-[10px] font-semibold leading-none text-black tabular-nums">
          {unread.unread > 99 ? '99+' : unread.unread}
        </span>
      )}

      {(broken || degraded) && (
        <span
          aria-hidden="true"
          className={`h-2 w-2 rounded-full ${broken ? 'bg-wa-danger' : 'bg-wa-warning'}`}
        />
      )}

      {/*
        Rotated rather than one letter per line: a stack of single characters is hard to read at a
        glance, and this strip has one job — to say what is behind it.
      */}
      <span
        className="mt-1 whitespace-nowrap text-[11px] tracking-wide"
        style={{ writingMode: 'vertical-rl' }}
      >
        Archiv und Einstellungen
      </span>
    </button>
  )
}
