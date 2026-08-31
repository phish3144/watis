import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { BrowserWindow } from 'electron'
import { resourcePath } from '../resources'
import { log } from '../logging'

/**
 * Renders PDF pages to images, so a scanned page can be handed to the text recognition
 * (PLAN.md Phase 7).
 *
 * A PDF page with no text layer is a picture of words, not a page without any. Recognising it needs
 * it rasterised first, and rasterising needs a canvas. Electron already has one — a hidden,
 * offscreen window with pdf.js in it — so this uses that rather than adding a native canvas module
 * to the dependency list for one feature.
 *
 * The window is created on demand and closed when the work is done. It loads no remote content and
 * runs with node integration off; the only thing that reaches it is a data URL of the PDF's own
 * bytes, which the application already has on disk.
 */

const SCALE = 2
/** Beyond this a page is not a scan, it is a poster; and OCR on it would take minutes. */
const MAX_DIMENSION = 4000
const MAX_PAGES_PER_CALL = 20

export interface RenderRequest {
  file: string
  /** 1-based page numbers, as `scannedPages` reports them. */
  pages: number[]
}

export interface RenderedPage {
  page: number
  /** PNG bytes, base64. A string is what survives the worker boundary. */
  data: string
}

let window: BrowserWindow | undefined

function offscreenWindow(): BrowserWindow {
  if (window && !window.isDestroyed()) return window
  window = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      // No preload and no remote content: this window exists to run pdf.js over bytes we already
      // have, and giving it anything else to reach for would be giving it away for nothing.
      javascript: true,
    },
  })
  return window
}

export function closePdfRenderer(): void {
  if (window && !window.isDestroyed()) window.close()
  window = undefined
}

export async function renderPdfPages(request: RenderRequest): Promise<RenderedPage[]> {
  const pages = [...new Set(request.pages)].filter((n) => n > 0).slice(0, MAX_PAGES_PER_CALL)
  if (pages.length === 0) return []

  const pdfBytes = await readFile(request.file)
  const require_ = createRequire(import.meta.url)
  // The bare specifier would resolve relative to the page, which is a blank document — the module
  // has to be located here and handed over as a file URL.
  const pdfjsUrl = pathToFileURL(require_.resolve('pdfjs-dist/legacy/build/pdf.mjs')).toString()
  const workerUrl = pathToFileURL(
    require_.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'),
  ).toString()

  const view = offscreenWindow()
  if (view.webContents.getURL() === '') {
    // A real file:// page, not a data: URL. A data: URL has an opaque origin and dynamic import()
    // of a file:// module from one is refused outright — which is exactly how this failed first
    // time round, with a "failed to fetch dynamically imported module" and nothing else.
    await view.loadURL(pathToFileURL(resourcePath('pdf', 'render.html')).toString())
  }

  const script = `(async () => {
    const pdfjs = await import(${JSON.stringify(pdfjsUrl)})
    pdfjs.GlobalWorkerOptions.workerSrc = ${JSON.stringify(workerUrl)}
    const bytes = Uint8Array.from(atob(${JSON.stringify(pdfBytes.toString('base64'))}), (c) => c.charCodeAt(0))
    // The loading task is what owns the worker, and destroying the document proxy is not the same
    // thing — pdf.js only has destroy() on the task.
    const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false })
    const doc = await task.promise
    const out = []
    for (const number of ${JSON.stringify(pages)}) {
      if (number > doc.numPages) continue
      const page = await doc.getPage(number)
      let viewport = page.getViewport({ scale: ${String(SCALE)} })
      const longest = Math.max(viewport.width, viewport.height)
      if (longest > ${String(MAX_DIMENSION)}) {
        viewport = page.getViewport({ scale: (${String(SCALE)} * ${String(MAX_DIMENSION)}) / longest })
      }
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const context = canvas.getContext('2d')
      // A scan on a transparent canvas recognises badly; paper is white.
      context.fillStyle = '#ffffff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: context, viewport }).promise
      out.push({ page: number, data: canvas.toDataURL('image/png').split(',')[1] })
      page.cleanup()
    }
    await task.destroy()
    return out
  })()`

  // Not caught into an empty array: a render that failed and one that had nothing to do look
  // identical from the outside, and the caller has to be able to tell them apart. A page number
  // past the end of the document is the "nothing to do" case and is skipped inside the script.
  const rendered = (await view.webContents.executeJavaScript(script)) as RenderedPage[]
  log.info(`rendered ${String(rendered.length)} page(s) of ${request.file}`)
  return rendered
}
