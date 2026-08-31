import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BaseWindow, Menu, WebContentsView, session, shell } from 'electron'
import type { WebContents } from 'electron'
import { DISPLAY_NAME, WA_PARTITION, WA_URL } from '@shared/app-identity'
import { installPermissionHandlers } from '../session/permissions'
import { applySpellcheck } from '../session/spellcheck'
import { MINIMUM_SIZE, persistBounds, restoreBounds } from './bounds'
import { settings, updateSettings } from '../config/store'
import { log } from '../logging'

/**
 * One BaseWindow holding two WebContentsViews side by side: WhatsApp Web on the left, our own
 * panel on the right. No <webview> tag and no BrowserView — both are deprecated or discouraged.
 *
 * Views are OS-level and do not reflow with CSS, so the split is laid out from main on every
 * resize.
 */

const PANEL_WIDTH = 460
const PANEL_MIN_WIDTH = 320

export interface MainWindow {
  window: BaseWindow
  wa: WebContentsView
  panel: WebContentsView
  togglePanel(): void
  setPanelVisible(visible: boolean): void
  isPanelVisible(): boolean
  show(): void
}

/**
 * Ctrl/Cmd+, opens the settings panel, and Escape closes it. Registered per view rather than as
 * a global shortcut: a global accelerator would steal the key from every other application.
 */
function installPanelShortcut(contents: WebContents, toggle: () => void, close: () => void): void {
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const modifier = process.platform === 'darwin' ? input.meta : input.control
    if (modifier && input.key === ',') {
      event.preventDefault()
      toggle()
    } else if (input.key === 'Escape') {
      close()
    }
  })
}

function loadOwnPanel(view: WebContentsView): Promise<void> {
  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) return view.webContents.loadURL(devServer)
  return view.webContents.loadURL(
    pathToFileURL(join(__dirname, '../renderer/index.html')).toString(),
  )
}

/** Copy, paste, spellcheck suggestions, save image — the things a browser context menu has. */
function installContextMenu(contents: WebContents): void {
  contents.on('context-menu', (_event, params) => {
    const items: Electron.MenuItemConstructorOptions[] = []

    for (const suggestion of params.dictionarySuggestions.slice(0, 5)) {
      items.push({
        label: suggestion,
        click: () => {
          contents.replaceMisspelling(suggestion)
        },
      })
    }
    if (items.length) items.push({ type: 'separator' })

    if (params.linkURL) {
      items.push(
        {
          label: 'Link im Browser öffnen',
          click: () => {
            void shell.openExternal(params.linkURL)
          },
        },
        {
          label: 'Link kopieren',
          click: () => {
            contents.copy()
          },
        },
        { type: 'separator' },
      )
    }

    if (params.mediaType === 'image' && params.srcURL) {
      items.push(
        {
          label: 'Bild kopieren',
          click: () => {
            contents.copyImageAt(params.x, params.y)
          },
        },
        {
          label: 'Bild speichern unter …',
          click: () => {
            contents.downloadURL(params.srcURL)
          },
        },
        { type: 'separator' },
      )
    }

    items.push(
      { label: 'Rückgängig', role: 'undo', enabled: params.editFlags.canUndo },
      { label: 'Wiederholen', role: 'redo', enabled: params.editFlags.canRedo },
      { type: 'separator' },
      { label: 'Ausschneiden', role: 'cut', enabled: params.editFlags.canCut },
      { label: 'Kopieren', role: 'copy', enabled: params.editFlags.canCopy },
      { label: 'Einfügen', role: 'paste', enabled: params.editFlags.canPaste },
      { label: 'Alles auswählen', role: 'selectAll' },
    )

    Menu.buildFromTemplate(items).popup()
  })
}

export function createMainWindow(options: { startMinimised: boolean }): MainWindow {
  const { bounds, maximised } = restoreBounds()
  const config = settings()

  const window = new BaseWindow({
    ...bounds,
    ...MINIMUM_SIZE,
    show: false,
    title: DISPLAY_NAME,
    backgroundColor: '#111b21',
    autoHideMenuBar: true,
  })

  const waSession = session.fromPartition(WA_PARTITION)
  installPermissionHandlers(waSession)
  applySpellcheck(waSession, config.spellcheckLanguages)

  const wa = new WebContentsView({
    webPreferences: {
      partition: WA_PARTITION,
      preload: join(__dirname, '../preload/wa.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // The flag only makes the checker *available*; it is switched off at the session until the
      // user picks a language, because on Windows the first language set makes Chromium fetch
      // dictionaries from a Google host. See session/spellcheck.ts.
      spellcheck: true,
      // Without this Chromium throttles timers in a background window and notifications arrive
      // minutes late. Measured: a hidden view keeps its timers for at least 7 minutes with it.
      backgroundThrottling: false,
    },
  })

  const panel = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/app.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  window.contentView.addChildView(wa)
  window.contentView.addChildView(panel)

  let panelVisible = false

  const layout = (): void => {
    const { width, height } = window.getContentBounds()
    const panelWidth = panelVisible
      ? Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_WIDTH, Math.floor(width / 2)))
      : 0
    wa.setBounds({ x: 0, y: 0, width: Math.max(0, width - panelWidth), height })
    panel.setBounds({ x: Math.max(0, width - panelWidth), y: 0, width: panelWidth, height })
  }

  window.on('resize', layout)
  window.on('maximize', layout)
  window.on('unmaximize', layout)

  const savePlacement = (): void => {
    persistBounds(window.getNormalBounds(), window.isMaximized())
  }
  window.on('resized', savePlacement)
  window.on('moved', savePlacement)
  window.on('maximize', savePlacement)
  window.on('unmaximize', savePlacement)
  window.on('close', savePlacement)

  for (const view of [wa, panel]) {
    // External links never open a new Electron window — they go to the default browser.
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url)
      else log.warn(`blocked window.open for a non-http url: ${url.slice(0, 120)}`)
      return { action: 'deny' }
    })

    view.webContents.on('will-navigate', (event, url) => {
      const isWa = url.startsWith('https://web.whatsapp.com')
      const isLocal = url.startsWith('file://') || url.startsWith('http://localhost')
      if (!isWa && !isLocal) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })

    installContextMenu(view.webContents)
  }

  const setPanelVisible = (visible: boolean): void => {
    if (panelVisible === visible) return
    panelVisible = visible
    layout()
    if (visible) panel.webContents.focus()
    else wa.webContents.focus()
  }

  for (const view of [wa, panel]) {
    installPanelShortcut(
      view.webContents,
      () => {
        setPanelVisible(!panelVisible)
      },
      () => {
        setPanelVisible(false)
      },
    )
  }

  // Zoom is remembered across restarts; Ctrl +/-/0 is handled by Chromium itself.
  wa.webContents.on('did-finish-load', () => {
    wa.webContents.setZoomLevel(settings().zoomLevel)
  })
  wa.webContents.on('zoom-changed', (_event, direction) => {
    const next = wa.webContents.getZoomLevel() + (direction === 'in' ? 0.5 : -0.5)
    const clamped = Math.max(-5, Math.min(5, next))
    wa.webContents.setZoomLevel(clamped)
    updateSettings({ zoomLevel: clamped })
  })

  void wa.webContents.loadURL(WA_URL)
  void loadOwnPanel(panel)

  if (maximised) window.maximize()
  layout()

  const show = (): void => {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  if (!options.startMinimised && !config.startMinimised) show()

  return {
    window,
    wa,
    panel,
    show,
    isPanelVisible: () => panelVisible,
    setPanelVisible,
    togglePanel: () => {
      setPanelVisible(!panelVisible)
    },
  }
}
