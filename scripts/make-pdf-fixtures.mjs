#!/usr/bin/env node
// Two PDF fixtures: one with a real text layer, one that is a picture of text (a "scan").
// Invented content only — no real document enters the repository (CLAUDE.md).
import { chromium } from 'playwright'

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
})

const page = await browser.newPage()
await page.setContent(`<!doctype html><meta charset="utf-8">
<style>body{font:16px/1.6 "DejaVu Sans",sans-serif;padding:40px}h1{font-size:22px}</style>
<h1>Angebot 2026-4711</h1>
<p>Küchenmöbel Müller GmbH, Straßenweg 12, München</p>
<p>Lieferung frei Haus. Gesamtbetrag 1.249,90 Euro.</p>
<div style="page-break-before:always"></div>
<h1>Seite zwei</h1>
<p>Zahlungsziel 14 Tage ohne Abzug. Grüße aus dem Vertrieb.</p>`)
await page.pdf({ path: 'test/fixtures/angebot-text.pdf', format: 'A4' })

// The "scan": the same words drawn into a canvas, so the PDF carries an image and no text layer.
await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0">
<canvas id="c" width="800" height="400"></canvas>
<script>
  const ctx = document.getElementById('c').getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 800, 400)
  ctx.fillStyle = '#000'; ctx.font = '28px "DejaVu Sans", sans-serif'
  ctx.fillText('Gescanntes Angebot', 40, 70)
  ctx.fillText('Gesamtbetrag 1.249,90 Euro', 40, 130)
</script></body>`)
await page.waitForTimeout(300)
await page.pdf({ path: 'test/fixtures/angebot-scan.pdf', format: 'A4' })

await browser.close()
console.log('wrote test/fixtures/angebot-text.pdf and angebot-scan.pdf')
