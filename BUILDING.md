# Building the WatIs? browser extension from source

For store reviewers (addons.mozilla.org, Chrome Web Store, Microsoft Edge Add-ons) and anyone who
wants to check that a published package is built from this source. The rest of the project's
documentation is in German; this file is in English because of who reads it.

## Environment

- Node.js **24** (the project pins 24.18.1 in `.nvmrc`) with the npm that ships with it.
- Linux, macOS or Windows. The maintainers build on Linux x64 (Ubuntu 24.04). The build tools'
  native parts (Rollup, Lightning CSS, Tailwind's oxide) come as prebuilt npm packages for x64 and
  arm64.
- No other tools, no global installs, no network access beyond the npm registry during `npm ci`.

## Build

```sh
npm ci
npm run build:extension
```

This writes two unpacked extensions:

| Folder                    | Store                          | Release asset                   |
| ------------------------- | ------------------------------ | ------------------------------- |
| `out/extension/firefox/`  | addons.mozilla.org             | `WatIs-Browser-Firefox.zip`     |
| `out/extension/chromium/` | Chrome Web Store, Edge Add-ons | `WatIs-Browser-Chrome-Edge.zip` |

`npm run pack:extension` additionally zips both into `out/extension/watis-<version>-*.zip`; the
release assets are those ZIPs renamed. The build is reproducible: two builds of the same commit
produce identical files, so `diff -r` against an unpacked release asset shows no differences.

Everything happens in one script, `scripts/build-extension.mjs`, with comments for each step.

## What is ours, and what is copied unmodified

**Our code** (`src/extension/`, `src/bridge/`, `src/shared/`, `src/workers/archive/`) is TypeScript
and React, bundled with Vite 7. It is **not minified**: the output is meant to be read.

**Copied byte for byte** from the npm packages pinned in `package-lock.json`:

| File in the package                    | Source                                                          |
| -------------------------------------- | --------------------------------------------------------------- |
| `ocr/worker.min.js`                    | `tesseract.js@7.0.0`, `dist/worker.min.js`                      |
| `ocr/worker.min.js.LICENSE.txt`        | `tesseract.js@7.0.0`, `dist/worker.min.js.LICENSE.txt`          |
| `ocr/tesseract-core-simd-lstm.wasm.js` | `tesseract.js-core@7.0.0`, `tesseract-core-simd-lstm.wasm.js`   |
| `ocr/pdf.worker.min.mjs`               | `pdfjs-dist@6.3.289`, `legacy/build/pdf.worker.min.mjs`         |
| `whisper/shout.wasm.js`                | `@transcribe/shout@1.0.7`, `src/shout/shout.wasm.js`            |
| `assets/sqlite3-*.wasm`                | `@sqlite.org/sqlite-wasm@3.53.4-build2` (emitted by Vite as is) |

**Language data** for text recognition, `ocr/lang/deu.traineddata` and `ocr/lang/eng.traineddata`,
comes from `resources/tessdata/` in this repository and is identical to
[tessdata_fast 4.1.0](https://github.com/tesseract-ocr/tessdata_fast/tree/4.1.0):

```
19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d  deu.traineddata
7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2  eng.traineddata
```

`THIRD_PARTY_NOTICES.txt` lists every bundled package with its full licence text.

## What the extension does, for review

- It runs on `https://web.whatsapp.com/*` only. It reads what WhatsApp Web shows and stores it in a
  local SQLite database in the extension's origin-private file system. It **never sends** a message,
  never marks anything as read on its own and has no server: nothing leaves the browser.
- Text recognition (Tesseract) and transcription (whisper.cpp) run locally as WebAssembly.
- The only other network access is optional: after the user clicks, it asks for the optional host
  permission for GitHub and downloads a Whisper speech model (weights only, no code) from this
  repository's releases.
- Testing needs a WhatsApp account, which is bound to a phone number, so we cannot hand one out.
  The end-to-end tests run the same packages against a stand-in WhatsApp Web page:
  `npm run test:extension` (Chromium) and `npm run test:extension:firefox`
  (`FIREFOX=/path/to/firefox`).
