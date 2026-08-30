import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BaseWindow, WebContentsView, shell, session } from 'electron'
import { DISPLAY_NAME, WA_PARTITION, WA_URL } from '@shared/app-identity'
import { installPermissionHandlers } from '../session/permissions'
import { MINIMUM_SIZE, persistBounds, restoreBounds } from './bounds'
import { log } from '../logging'

/**
 * One BaseWindow holding two WebContentsViews side by side: WhatsApp Web on the left, our own
 * React panel on the right. No <webview> tag, no BrowserView — both are deprecated or
 * discouraged and tied to Chromium architecture churn.
 *
 * Views are OS-level and do not reflow with CSS, so the split is laid out here in main whenever
 * the window resizes.
 */

const PANEL_WIDTH = 420

/** electron-vite serves the renderer from a dev server while developing and from disk once built. */
function loadOwnPanel(view: WebContentsView): Promise<void> {
  const devServer = process.env.ELECTRON_RENDERER_URL
  if (devServer) return view.webContents.loadURL(devServer)
  return view.webContents.loadURL(
    pathToFileURL(join(__dirname, '../renderer/index.html')).toString(),
  )
}

export interface MainWindow {
  window: BaseWindow
  wa: WebContentsView
  app: WebContentsView
  togglePanel(): void
  isPanelVisible(): boolean
}

export function createMainWindow(options: { startMinimised: boolean }): MainWindow {
  const { bounds, maximised } = restoreBounds()

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

  const wa = new WebContentsView({
    webPreferences: {
      partition: WA_PARTITION,
      preload: join(__dirname, '../preload/wa.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // webPreferences.spellcheck defaults to TRUE, and on Windows Electron then downloads
      // hunspell dictionaries from Chromium's CDN — outbound traffic to Google hosts, which
      // breaks the "network only to WhatsApp and GitHub Releases" rule. macOS uses the OS
      // speller and downloads nothing. Off until phase 1 decides between shipping dictionaries
      // and accepting the download (PLAN.md phase 1, "Spellcheck mit mehreren Sprachen").
      spellcheck: process.platform === 'darwin',
      // Without this Chromium throttles timers in a background window and notifications arrive
      // minutes late. Measured: a hidden view keeps its timers for at least 7 minutes with this
      // set, well past Chromium's 5-minute intensive-throttling grace period.
      backgroundThrottling: false,
    },
  })

  const app = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/app.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.contentView.addChildView(wa)
  window.contentView.addChildView(app)

  let panelVisible = false

  const layout = (): void => {
    const { width, height } = window.getContentBounds()
    const panel = panelVisible ? Math.min(PANEL_WIDTH, Math.floor(width / 2)) : 0
    wa.setBounds({ x: 0, y: 0, width: width - panel, height })
    app.setBounds({ x: width - panel, y: 0, width: panel, height })
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

  // External links never open a new Electron window — they go to the default browser.
  for (const view of [wa, app]) {
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:/.test(url)) void shell.openExternal(url)
      else log.warn(`blocked window.open for non-http url: ${url.slice(0, 120)}`)
      return { action: 'deny' }
    })

    // Keep the views pinned to their origin; anything else goes to the browser.
    view.webContents.on('will-navigate', (event, url) => {
      const isWa = url.startsWith(WA_URL) || url.startsWith('https://web.whatsapp.com')
      const isLocal = url.startsWith('file://') || url.startsWith('http://localhost')
      if (!isWa && !isLocal) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })
  }

  void wa.webContents.loadURL(WA_URL)
  void loadOwnPanel(app)

  if (maximised) window.maximize()
  layout()

  if (!options.startMinimised) window.show()

  return {
    window,
    wa,
    app,
    isPanelVisible: () => panelVisible,
    togglePanel: () => {
      panelVisible = !panelVisible
      layout()
    },
  }
}
