// The licence texts of everything WatIs? bundles, in one file that ships with it.
//
// MIT asks for its copyright notice and permission notice "in all copies or substantial portions",
// and the Apache License for a copy of the licence and any NOTICE file. A bundler drops the files
// those sit in, so a list of names with a link is not enough — this collects the texts themselves
// from each package that actually ended up in a bundle, and the build fails on a package it cannot
// find a licence text for rather than shipping it without one.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'

/** The package a bundled module belongs to, from its path inside node_modules. */
export function packageOf(id) {
  const clean = id.replace(/^\0/, '').split('?')[0].split(sep).join('/')
  const at = clean.lastIndexOf('/node_modules/')
  if (at < 0) return undefined
  const rest = clean.slice(at + '/node_modules/'.length).split('/')
  return rest[0]?.startsWith('@') ? `${rest[0]}/${rest[1]}` : rest[0]
}

/** A Rollup/Vite plugin that adds every bundled package to `into`. */
export function collectPackages(into) {
  return {
    name: 'watis-third-party-packages',
    buildEnd() {
      for (const id of this.getModuleIds()) {
        const name = packageOf(id)
        if (name) into.add(name)
      }
    },
  }
}

const LICENCE_FILE = /^(licen[cs]e|copying|notice)([-.](mit|apache|bsd|md|txt|markdown))*$/i

/** Packages whose licence text is not in their own package, and where it is instead. */
const KNOWN_ELSEWHERE = {
  // Ships no licence file; its licence is the Apache License 2.0, appended in full below.
  '@sqlite.org/sqlite-wasm': 'apache',
}

const MIT_PERMISSION = `Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`

/** An MIT notice for work that is not an npm package of its own. */
export function mit(copyright) {
  return `MIT License\n\n${copyright}\n\n${MIT_PERMISSION}`
}

function packageDir(root, name) {
  const dir = join(root, 'node_modules', ...name.split('/'))
  if (!existsSync(join(dir, 'package.json')))
    throw new Error(`third-party notices: ${name} is not installed`)
  return dir
}

/**
 * Writes the notices for `packages` and `extras` (`{ name, licence, text }` for work that is not a
 * package, such as language data) to `file`.
 */
export function writeNotices({ root, file, product, packages, extras = [] }) {
  const sections = []
  let needsApache = false

  for (const name of [...packages].sort()) {
    const dir = packageDir(root, name)
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    const licence = typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license)
    const texts = readdirSync(dir)
      .filter((entry) => LICENCE_FILE.test(entry))
      .sort()
      .map((entry) => readFileSync(join(dir, entry), 'utf8').trim())
    if (/apache/i.test(licence)) needsApache = true
    if (texts.length === 0 && KNOWN_ELSEWHERE[name] !== 'apache') {
      throw new Error(
        `third-party notices: no licence text for ${name}@${pkg.version} (${licence})`,
      )
    }
    sections.push(
      [
        `${name} ${pkg.version}`,
        `Licence: ${licence}`,
        ...(texts.length > 0
          ? texts
          : ['The full text of the Apache License 2.0 is at the end of this file.']),
      ].join('\n\n'),
    )
  }

  for (const extra of extras) {
    if (/apache/i.test(extra.licence)) needsApache = true
    sections.push(
      [extra.name, `Licence: ${extra.licence}`, extra.text].filter(Boolean).join('\n\n'),
    )
  }

  const apache = needsApache
    ? readFileSync(join(packageDir(root, 'pdfjs-dist'), 'LICENSE'), 'utf8').trim()
    : undefined
  const rule = '\n\n' + '-'.repeat(78) + '\n\n'
  writeFileSync(
    file,
    [
      `${product} includes the following third-party software. Each is listed with its licence ` +
        'and, where it has them, its copyright and NOTICE texts as its authors ship them.',
      ...sections,
      ...(apache ? [`Apache License 2.0, the full text:\n\n${apache}`] : []),
    ].join(rule) + '\n',
  )
}

const BSD_DISCLAIMER = `THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`

/** A BSD-3-Clause notice for work that is not an npm package of its own. */
export function bsd3(copyright, owner = 'the copyright holder') {
  return `${copyright}

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

  * Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.

  * Redistributions in binary form must reproduce the above copyright
    notice, this list of conditions and the following disclaimer in
    the documentation and/or other materials provided with the
    distribution.

  * Neither the name of ${owner} nor the names of its contributors may
    be used to endorse or promote products derived from this software
    without specific prior written permission.

${BSD_DISCLAIMER}`
}

/**
 * tesseract.js-core is a WebAssembly build of Tesseract OCR together with the image libraries it
 * reads files with, and ships only its own Apache licence. The libraries were identified from the
 * compiled module itself (their messages and version strings); these are their notices.
 */
export const TESSERACT_COMPONENTS = [
  {
    name: 'Tesseract OCR language data, tessdata_fast (deu, eng)',
    licence: 'Apache-2.0',
    text: 'From https://github.com/tesseract-ocr/tessdata_fast',
  },
  {
    name: 'Leptonica (inside tesseract.js-core)',
    licence: 'BSD-2-Clause',
    text: `Copyright (C) 2001 Leptonica. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
1. Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above
   copyright notice, this list of conditions and the following
   disclaimer in the documentation and/or other materials
   provided with the distribution.

${BSD_DISCLAIMER}`,
  },
  {
    name: 'LibTIFF (inside tesseract.js-core)',
    licence: 'libtiff',
    text: `Copyright (c) 1988-1997 Sam Leffler
Copyright (c) 1991-1997 Silicon Graphics, Inc.

Permission to use, copy, modify, distribute, and sell this software and
its documentation for any purpose is hereby granted without fee, provided
that (i) the above copyright notices and this permission notice appear in
all copies of the software and related documentation, and (ii) the names of
Sam Leffler and Silicon Graphics may not be used in any advertising or
publicity relating to the software without the specific, prior written
permission of Sam Leffler and Silicon Graphics.

THE SOFTWARE IS PROVIDED "AS-IS" AND WITHOUT WARRANTY OF ANY KIND,
EXPRESS, IMPLIED OR OTHERWISE, INCLUDING WITHOUT LIMITATION, ANY
WARRANTY OF MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE.

IN NO EVENT SHALL SAM LEFFLER OR SILICON GRAPHICS BE LIABLE FOR
ANY SPECIAL, INCIDENTAL, INDIRECT OR CONSEQUENTIAL DAMAGES OF ANY KIND,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER OR NOT ADVISED OF THE POSSIBILITY OF DAMAGE, AND ON ANY THEORY OF
LIABILITY, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE
OF THIS SOFTWARE.`,
  },
  {
    name: 'libwebp (inside tesseract.js-core)',
    licence: 'BSD-3-Clause',
    text: bsd3('Copyright (c) 2010, Google Inc. All rights reserved.', 'Google'),
  },
  {
    name: 'libjpeg (inside tesseract.js-core)',
    licence: 'IJG',
    text: 'This software is based in part on the work of the Independent JPEG Group.',
  },
  {
    name: 'libpng (inside tesseract.js-core)',
    licence: 'libpng / PNG Reference Library License',
    text: 'Copyright (c) the PNG Reference Library Authors. https://www.libpng.org/pub/png/src/libpng-LICENSE.txt',
  },
  {
    name: 'zlib 1.2.12 (inside tesseract.js-core)',
    licence: 'Zlib',
    text: 'Copyright (C) 1995-2022 Jean-loup Gailly and Mark Adler. https://zlib.net/zlib_license.html',
  },
]

export const SQLITE = {
  name: 'SQLite',
  licence: 'Public domain',
  text: `The author disclaims copyright to this source code. In place of a legal notice, here is a blessing:

    May you do good and not evil.
    May you find forgiveness for yourself and forgive others.
    May you share freely, never taking more than you give.`,
}
