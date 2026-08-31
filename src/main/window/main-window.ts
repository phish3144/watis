import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BaseWindow, Menu, WebContentsView, session, shell } from 'electron'
import type { WebContents } from 'electron'
import { DISPLAY_NAME, WA_URL } from '@shared/app-identity'
import { partitionFor } from '@shared/accounts'
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
  /** The view of the account currently in front. */
  wa: WebContentsView
  panel: WebContentsView
  /** Every account's view, including the ones behind. */
  views(): { accountId: string; view: WebContentsView }[]
  viewFor(accountId: string): WebContentsView | undefined
  activeAccount(): string
  /** Brings an account to the front. Its view was already running behind. */
  showAccount(accountId: string): void
  /** Creates a view for an account added while the app was running. */
  addAccountView(accountId: string): WebContentsView
  removeAccountView(accountId: string): void
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

export function createMainWindow(options: {
  startMinimised: boolean
  accountIds: readonly string[]
  activeAccountId: string
}): MainWindow {
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

  /**
   * One view per account, all of them running (PLAN.md Phase 8).
   *
   * The ones behind stay loaded rather than being torn down and rebuilt on every switch. That is
   * the whole point of having several accounts: a background account has to keep receiving
   * messages, or its unread badge is a lie and its notifications never arrive. The cost is honest
   * and roughly a WhatsApp Web per account — which is what the feature is.
   */
  const accountViews = new Map<string, WebContentsView>()

  const createAccountView = (accountId: string): WebContentsView => {
    const partition = partitionFor(accountId)
    const accountSession = session.fromPartition(partition)
    installPermissionHandlers(accountSession)
    applySpellcheck(accountSession, config.spellcheckLanguages)

    const view = new WebContentsView({
      webPreferences: {
        partition,
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

    accountViews.set(accountId, view)
    window.contentView.addChildView(view)
    installExternalLinkHandling(view.webContents)
    installContextMenu(view.webContents)
    installZoomMemory(view.webContents)
    void view.webContents.loadURL(WA_URL)
    return view
  }

  const panel = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/app.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  window.contentView.addChildView(panel)

  let panelVisible = false
  let activeId = options.activeAccountId

  /**
   * The account behind is given a zero-size rectangle rather than being removed from the window.
   * Removing and re-adding a WebContentsView is what makes WhatsApp Web reload itself, and a reload
   * per switch would undo the reason the views are kept alive at all.
   */
  const layout = (): void => {
    const { width, height } = window.getContentBounds()
    const panelWidth = panelVisible
      ? Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_WIDTH, Math.floor(width / 2)))
      : 0
    const waWidth = Math.max(0, width - panelWidth)

    for (const [id, view] of accountViews) {
      if (id === activeId) view.setBounds({ x: 0, y: 0, width: waWidth, height })
      else view.setBounds({ x: 0, y: 0, width: 0, height: 0 })
    }
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

  installExternalLinkHandling(panel.webContents)
  installContextMenu(panel.webContents)

  const activeView = (): WebContentsView | undefined => accountViews.get(activeId)

  const setPanelVisible = (visible: boolean): void => {
    if (panelVisible === visible) return
    panelVisible = visible
    layout()
    if (visible) panel.webContents.focus()
    else activeView()?.webContents.focus()
  }

  const shortcuts = (contents: WebContents): void => {
    installPanelShortcut(
      contents,
      () => {
        setPanelVisible(!panelVisible)
      },
      () => {
        setPanelVisible(false)
      },
    )
  }
  shortcuts(panel.webContents)

  // Every account's view exists from the start; the ones behind are laid out at zero size.
  for (const id of options.accountIds) {
    const view = createAccountView(id)
    shortcuts(view.webContents)
  }
  if (!accountViews.has(activeId)) activeId = options.accountIds[0] ?? activeId

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
    // `wa` is whichever account is in front. Callers that only ever dealt with one account keep
    // working unchanged, and now mean "the account the user is looking at".
    get wa(): WebContentsView {
      const view = activeView()
      if (!view) throw new Error('no account view exists')
      return view
    },
    panel,
    show,
    views: () => [...accountViews].map(([accountId, view]) => ({ accountId, view })),
    viewFor: (accountId) => accountViews.get(accountId),
    activeAccount: () => activeId,
    showAccount: (accountId) => {
      if (!accountViews.has(accountId) || accountId === activeId) return
      activeId = accountId
      layout()
      accountViews.get(accountId)?.webContents.focus()
    },
    addAccountView: (accountId) => {
      const existing = accountViews.get(accountId)
      if (existing) return existing
      const view = createAccountView(accountId)
      shortcuts(view.webContents)
      layout()
      return view
    },
    removeAccountView: (accountId) => {
      const view = accountViews.get(accountId)
      if (!view) return
      accountViews.delete(accountId)
      window.contentView.removeChildView(view)
      view.webContents.close()
      if (activeId === accountId) activeId = [...accountViews.keys()][0] ?? activeId
      layout()
    },
    isPanelVisible: () => panelVisible,
    setPanelVisible,
    togglePanel: () => {
      setPanelVisible(!panelVisible)
    },
  }
}

/** External links never open a new Electron window — they go to the default browser. */
function installExternalLinkHandling(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    else log.warn(`blocked window.open for a non-http url: ${url.slice(0, 120)}`)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    const isWa = url.startsWith('https://web.whatsapp.com')
    const isLocal = url.startsWith('file://') || url.startsWith('http://localhost')
    if (!isWa && !isLocal) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })
}

/** Zoom is remembered across restarts; Ctrl +/-/0 is handled by Chromium itself. */
function installZoomMemory(contents: WebContents): void {
  contents.on('did-finish-load', () => {
    contents.setZoomLevel(settings().zoomLevel)
  })
  contents.on('zoom-changed', (_event, direction) => {
    const next = contents.getZoomLevel() + (direction === 'in' ? 0.5 : -0.5)
    const clamped = Math.max(-5, Math.min(5, next))
    contents.setZoomLevel(clamped)
    updateSettings({ zoomLevel: clamped })
  })
}
