/**
 * The extension manifest, generated per browser from one description (ADR 0010).
 *
 * Chrome and Edge share one package; Firefox gets its own, because three things genuinely differ:
 * the background (service worker vs. event page), the panel (`side_panel` vs. `sidebar_action`) and
 * Firefox's add-on id. Everything else — permissions, content scripts, CSP, the files — is the same,
 * and is written down once here so the two packages cannot drift apart.
 *
 * The display name carries the question mark; nothing that becomes a file name does (CLAUDE.md).
 */

export type Browser = 'chromium' | 'firefox'

const WHATSAPP = 'https://web.whatsapp.com/*'

/** Firefox add-on id. A stable id is what keeps OPFS, settings and the archive across updates. */
export const GECKO_ID = 'watis@phish3144.github.io'

export function buildManifest(browser: Browser, version: string): Record<string, unknown> {
  const icons = {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png',
  }

  const manifest: Record<string, unknown> = {
    manifest_version: 3,
    name: 'WatIs?',
    short_name: 'WatIs',
    version,
    description:
      'Lokales, durchsuchbares Archiv für WhatsApp Web – Volltextsuche, Medien, Texterkennung. Alles bleibt auf diesem Rechner.',
    icons,
    action: { default_title: 'WatIs?', default_icon: icons },
    permissions: [
      'storage',
      // OPFS is exempt from eviction only with this (docs/extension-spike.md, second experiment).
      'unlimitedStorage',
      'notifications',
      'downloads',
      ...(browser === 'chromium' ? ['sidePanel'] : []),
    ],
    host_permissions: [WHATSAPP],
    content_scripts: [
      {
        // Before WhatsApp's bundle runs: it captures window.Notification while it evaluates.
        matches: [WHATSAPP],
        js: ['page/shims.js'],
        run_at: 'document_start',
        world: 'MAIN',
      },
      {
        // Defers itself to the load event; see bridge-entry.ts.
        matches: [WHATSAPP],
        js: ['page/bridge.js'],
        run_at: 'document_start',
        world: 'MAIN',
      },
      {
        matches: [WHATSAPP],
        js: ['content/relay.js'],
        run_at: 'document_start',
      },
    ],
    web_accessible_resources: [
      // Only the frame page. Its worker, SQLite and the WASM stay invisible to web pages.
      { resources: ['host.html'], matches: [WHATSAPP] },
    ],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    // Without these, WhatsApp's COEP blocks every worker the host frame starts — measured, not
    // assumed (docs/extension-spike.md, third experiment).
    cross_origin_embedder_policy: { value: 'require-corp' },
    cross_origin_opener_policy: { value: 'same-origin' },
  }

  if (browser === 'chromium') {
    manifest.background = { service_worker: 'background.js' }
    manifest.side_panel = { default_path: 'panel.html' }
    manifest.minimum_chrome_version = '116'
  } else {
    manifest.background = { scripts: ['background.js'] }
    manifest.sidebar_action = {
      default_panel: 'panel.html',
      default_title: 'WatIs?',
      default_icon: icons,
      open_at_install: false,
    }
    manifest.browser_specific_settings = {
      gecko: {
        id: GECKO_ID,
        // `world: "MAIN"` content scripts arrived in Firefox 128.
        strict_min_version: '128.0',
        // Required for new listings on addons.mozilla.org. The truthful answer is: nothing.
        data_collection_permissions: { required: ['none'] },
      },
    }
  }

  return manifest
}
