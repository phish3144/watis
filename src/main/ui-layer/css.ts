import type { Settings } from '@shared/settings'

/**
 * The CSS layer injected into WhatsApp Web: compact mode, font scale, declutter switches.
 *
 * Selector strategy, from what actually survives WhatsApp's builds: IDs, ARIA roles and
 * WhatsApp's own data-* attributes are reasonably stable; class names are generated and change
 * constantly, and aria-label TEXT is localised so it cannot be matched on. Everything brittle is
 * collected here rather than scattered, so a WhatsApp change is a one-file repair.
 *
 * Each rule is written so that a selector which stops matching simply does nothing. Nothing here
 * removes elements from the DOM — it only hides them, so WhatsApp's own code never trips over a
 * missing node.
 */

/** One place for every selector that depends on WhatsApp's markup. */
export const WA_SELECTORS = {
  channelsTab:
    '[data-navbar-item="channels"], button[aria-label*="Kanäle"], button[aria-label*="Channels"]',
  statusTab:
    '[data-navbar-item="status"], button[aria-label*="Status"], button[aria-label*="Aktuelles"]',
  metaAi: '[data-navbar-item="ai"], [aria-label*="Meta AI"], [data-icon="meta-ai"]',
  chatList: '#pane-side',
  messageList: '[data-testid="conversation-panel-messages"], #main [role="application"]',
} as const

export function buildCss(config: Settings): string {
  const parts: string[] = ['/* watis ui-layer */']

  if (config.fontScale !== 1) {
    // Scaling the root font size rather than zooming keeps the layout proportions intact.
    parts.push(`html { font-size: ${(16 * config.fontScale).toFixed(2)}px !important; }`)
  }

  if (config.compactMode) {
    parts.push(`
      ${WA_SELECTORS.chatList} [role="listitem"] { --watis-compact: 1; }
      ${WA_SELECTORS.chatList} [role="listitem"] > div { padding-top: 4px !important; padding-bottom: 4px !important; }
      ${WA_SELECTORS.messageList} [data-pre-plain-text] { line-height: 1.25 !important; }
      ${WA_SELECTORS.messageList} .message-in, ${WA_SELECTORS.messageList} .message-out { margin-bottom: 2px !important; }
    `)
  }

  if (config.hideChannels) parts.push(`${WA_SELECTORS.channelsTab} { display: none !important; }`)
  if (config.hideStatus) parts.push(`${WA_SELECTORS.statusTab} { display: none !important; }`)
  if (config.hideMetaAi) parts.push(`${WA_SELECTORS.metaAi} { display: none !important; }`)

  return parts.join('\n')
}
