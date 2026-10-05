#!/usr/bin/env node
// Renders the voice-message fixture: an invented sentence, spoken by ffmpeg's built-in flite
// synthesiser and encoded the way WhatsApp sends voice messages — Opus in Ogg, mono, 16 kHz.
//
// Invented text, synthetic voice: no real message or real person's voice enters this repository
// (CLAUDE.md). flite only speaks English, which is fine for what the fixture proves — that the
// whole path from voice message to searchable transcript works — and Whisper detects the language.
//
//   node scripts/make-voice-fixture.mjs [out-dir]     (needs ffmpeg with libflite)

import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

const OUT_DIR = process.argv[2] ?? 'test/fixtures'
mkdirSync(OUT_DIR, { recursive: true })

const TEXT = 'The invoice for the kitchen arrives on Tuesday. Please call the carpenter.'

execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `flite=text='${TEXT}':voice=slt`,
    '-ac',
    '1',
    '-ar',
    '16000',
    '-c:a',
    'libopus',
    '-b:a',
    '16k',
    // A fixed bitstream serial and no encoder tag, so a regenerated file is byte-identical.
    '-serial_offset',
    '0',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    join(OUT_DIR, 'sprachnachricht.ogg'),
  ],
  { stdio: 'inherit' },
)
console.log(`ok    ${join(OUT_DIR, 'sprachnachricht.ogg')}`)
