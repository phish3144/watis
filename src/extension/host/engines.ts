import { extractPlainText, type Engine, type Extraction } from '../../workers/content-index/engine'

/**
 * The extraction engines available in the browser, keyed by index source (ADR 0010).
 *
 * Each one receives the blob's OPFS path where the desktop engines receive a disk path, and reads
 * the file itself. Which engines exist is decided here and only here; a source with no engine
 * yields skipped jobs, exactly as on the desktop.
 */

/** Opens a file by its path relative to the extension's OPFS root. */
export async function readOpfs(path: string): Promise<File> {
  const parts = path.split('/')
  const name = parts.pop()
  if (!name) throw new Error(`not a file path: ${path}`)
  let dir = await navigator.storage.getDirectory()
  for (const part of parts) dir = await dir.getDirectoryHandle(part)
  return (await dir.getFileHandle(name)).getFile()
}

/** TXT, Markdown, CSV: reading the file is the whole job. */
export const textEngine: Engine = {
  name: 'builtin-text',
  version: '1',
  source: 'text',
  isAvailable: () => Promise.resolve(true),
  extract: async (path: string): Promise<Extraction> =>
    extractPlainText(await (await readOpfs(path)).text()),
}

export function browserEngines(): Partial<Record<string, Engine>> {
  return { text: textEngine }
}
