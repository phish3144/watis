import { chromium } from '/home/user/watis/node_modules/playwright/index.mjs'
import { mkdtempSync } from 'node:fs'; import { tmpdir } from 'node:os'; import { join } from 'node:path'
const EXT = process.argv[2]
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 's-')), {
  headless: true, executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:8731/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(1500)
const url = await p.evaluate(() => document.documentElement.getAttribute('data-ext-page'))
if (!url) { console.log('NO EXTENSION PAGE URL'); await ctx.close(); process.exit(1) }
const q = await ctx.newPage()
q.on('console', (m) => { if (/STORAGE-PROBE/.test(m.text())) console.log(m.text()) })
await q.goto(url, { waitUntil: 'domcontentloaded' })
await q.waitForTimeout(70000)
await ctx.close()
