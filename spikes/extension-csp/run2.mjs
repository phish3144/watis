import { chromium } from '/home/user/watis/node_modules/playwright/index.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const EXT = process.argv[2]
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'w2-')), {
  headless: true,
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  proxy: { server: 'http://127.0.0.1:44767', bypass: '127.0.0.1,localhost' },
  args: [
    '--no-sandbox',
    '--disable-quic',
    '--ssl-version-max=tls1.2',
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
  ],
})
const page = await ctx.newPage()
const logs = []
page.on('console', (m) => logs.push(m.text()))
await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(9000)
for (const l of logs.filter((l) => /WATIS2|Refused/.test(l))) console.log(l.slice(0, 1200))
await ctx.close()
