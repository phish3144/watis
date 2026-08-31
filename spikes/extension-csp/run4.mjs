import { chromium } from '/home/user/watis/node_modules/playwright/index.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const EXT = process.argv[2]
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'coi-')), {
  headless: true,
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
const p = await ctx.newPage()
await p.goto('http://127.0.0.1:8731/', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(12000)
console.log(
  'COI-PROBE ' + (await p.evaluate(() => document.documentElement.getAttribute('data-coi'))),
)
await ctx.close()
