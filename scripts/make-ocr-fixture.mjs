#!/usr/bin/env node
// Renders the OCR fixture with a real font, so the test exercises recognition rather than a
// hand-drawn bitmap. Anonymous by construction: the text is invented (CLAUDE.md — no real
// messages, numbers or screenshots in the repository).
import { chromium } from 'playwright'

const OUT = process.argv[2] ?? 'test/fixtures/ocr-rechnung.png'
const HTML = `<!doctype html><meta charset="utf-8">
<style>
  body { margin:0; width:900px; background:#fff; color:#000;
         font:24px/1.6 "DejaVu Sans", sans-serif; padding:40px }
  h1 { font-size:30px; margin:0 0 24px }
  td { padding:4px 24px 4px 0 }
</style>
<h1>Rechnung Nr. 2026-0815</h1>
<table>
  <tr><td>Küchenmöbel Müller GmbH</td><td>Straßenweg 12</td></tr>
  <tr><td>Lieferung</td><td>Grüße aus München</td></tr>
  <tr><td>Gesamtbetrag</td><td>1.249,90 Euro</td></tr>
</table>`

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 900, height: 320 } })
await page.setContent(HTML)
await page.screenshot({ path: OUT })
await browser.close()
console.log(`wrote ${OUT}`)
