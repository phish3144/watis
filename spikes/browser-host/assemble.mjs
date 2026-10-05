// Copies ext/ plus the sqlite-wasm build into a temp dir with the manifest for one browser.
import { cpSync, mkdtempSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
export function assemble(browser) {
  const dir = mkdtempSync(join(tmpdir(), `watis-host-${browser}-`))
  const here = new URL('.', import.meta.url).pathname
  cpSync(join(here, 'ext'), dir, { recursive: true })
  copyFileSync(join(dir, `manifest.${browser}.json`), join(dir, 'manifest.json'))
  const sqlite = join(here, '../../node_modules/@sqlite.org/sqlite-wasm/dist')
  cpSync(sqlite, join(dir, 'sqlite'), { recursive: true })
  return dir
}
