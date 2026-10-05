import { FileTranscriber } from '@transcribe/transcriber'
import { parseSettings } from '@shared/settings'
import config from './whisper-models.json'
import { ext } from './ext'
import { SETTINGS_KEY } from './protocol'
import { t } from './panel/strings'

/**
 * whisper.cpp compiled to WASM, run on demand, one voice message at a time (ADR 0001 §4,
 * ADR 0012). Shared by the two places that can run it:
 *
 * - the **panel** in Chrome and Edge, which the manifest makes cross-origin isolated;
 * - the **archive frame in the WhatsApp tab** in Firefox, which ignores those manifest keys for
 *   its own pages but isolates that frame (measured, docs/extension-spike.md, third experiment).
 *
 * Decoding Opus needs an AudioContext, which only a page has, and whisper.cpp's threads need
 * SharedArrayBuffer, which only an isolated page has — so it runs in a page, never in a worker of
 * ours. The models live in the extension's OPFS under `models/`; getting them there is the
 * panel's business (`panel/transcribe.ts`).
 */

export type ModelKey = keyof typeof config.models
export const MODELS = config.models
export const DEFAULT_MODEL = config.default as ModelKey
export const MODEL_DIR = 'models'
export const MODEL_RELEASE = config.release

/** A loaded model stays in memory this long after its last use, so a run of messages loads it once. */
const KEEP_LOADED_MS = 120_000

export interface StoreTranscript {
  op: 'storeTranscript'
  mediaId: string
  text: string
  lines: { text: string; startSeconds: number; endSeconds: number }[]
  engine: string
  engineVersion: string
  lang: string
}

/** Whether this page can run whisper.cpp: its threads share memory, which needs isolation. */
export function canRunHere(): boolean {
  return globalThis.crossOriginIsolated && typeof SharedArrayBuffer === 'function'
}

/** Opens a file by its path relative to the extension's OPFS root. */
async function readOpfs(path: string): Promise<File> {
  const parts = path.split('/')
  const name = parts.pop()
  if (!name) throw new Error(`not a file path: ${path}`)
  let dir = await navigator.storage.getDirectory()
  for (const part of parts) dir = await dir.getDirectoryHandle(part)
  return (await dir.getFileHandle(name)).getFile()
}

export async function modelDir(create = false): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle(MODEL_DIR, { create })
  } catch {
    return undefined
  }
}

/** Which models are on this machine, by key. A partial download does not count. */
export async function installedModels(): Promise<ModelKey[]> {
  const dir = await modelDir()
  if (!dir) return []
  const installed: ModelKey[] = []
  for (const key of Object.keys(MODELS) as ModelKey[]) {
    try {
      const file = await (await dir.getFileHandle(MODELS[key].file)).getFile()
      if (file.size === MODELS[key].bytes) installed.push(key)
    } catch {
      // not there
    }
  }
  return installed
}

// --- running whisper.cpp ------------------------------------------------------------------------

type CreateModule = (arg?: object) => Promise<unknown>

let shout: Promise<CreateModule> | undefined

/**
 * whisper.cpp's Emscripten glue, loaded from the package as a module of its own rather than
 * bundled: its threads start workers from `new URL("shout.wasm.js", import.meta.url)`, and that
 * only resolves to the right file when the module keeps its own URL. A bundled copy would make
 * Emscripten fall back to a blob: worker, which the extension's CSP forbids.
 */
function loadShout(): Promise<CreateModule> {
  shout ??= import(/* @vite-ignore */ ext.runtime.getURL('whisper/shout.wasm.js')).then(
    (module: { default: CreateModule }) => module.default,
  )
  return shout
}

let loaded:
  { key: ModelKey; transcriber: FileTranscriber; ready: Promise<void>; idle?: number } | undefined

/** Frees the loaded model — all of them, or only `key` if that is the one loaded. */
export function unload(key?: ModelKey): void {
  if (key !== undefined && loaded?.key !== key) return
  if (!loaded) return
  window.clearTimeout(loaded.idle)
  loaded.transcriber.destroy()
  loaded = undefined
}

async function transcriberFor(
  key: ModelKey,
  onProgress: (percent: number) => void,
): Promise<FileTranscriber> {
  if (loaded?.key !== key) {
    unload()
    const transcriber = new FileTranscriber({
      createModule: await loadShout(),
      model: await readOpfs(`${MODEL_DIR}/${MODELS[key].file}`),
      print: () => undefined,
      printErr: () => undefined,
    })
    loaded = { key, transcriber, ready: transcriber.init() }
  }
  const current = loaded
  window.clearTimeout(current.idle)
  try {
    await current.ready
  } catch (error) {
    unload()
    throw error
  }
  current.transcriber.onProgress = onProgress
  return current.transcriber
}

function releaseLater(): void {
  if (!loaded) return
  window.clearTimeout(loaded.idle)
  loaded.idle = window.setTimeout(() => {
    unload()
  }, KEEP_LOADED_MS)
}

/** One message at a time: a second click waits for the first instead of doubling the memory. */
let queue: Promise<unknown> = Promise.resolve()

/**
 * Transcribes one voice message from the archive and stores the result there, where the search
 * finds it like any other text. Progress is reported 0..100 by whisper.cpp itself.
 */
export function transcribeHere(
  mediaId: string,
  audioPath: string,
  onProgress: (percent: number) => void,
  store: (transcript: StoreTranscript) => Promise<void>,
): Promise<string> {
  const run = queue.then(() => transcribeNow(mediaId, audioPath, onProgress, store))
  queue = run.catch(() => undefined)
  return run
}

async function transcribeNow(
  mediaId: string,
  audioPath: string,
  onProgress: (percent: number) => void,
  store: (transcript: StoreTranscript) => Promise<void>,
): Promise<string> {
  if (!canRunHere()) {
    throw new Error(t('transcription.unsupported'))
  }
  const installed = await installedModels()
  const key = installed.includes(DEFAULT_MODEL) ? DEFAULT_MODEL : installed[0]
  if (!key) throw new Error(t('transcription.needModel'))

  const stored = await ext.storage.local.get(SETTINGS_KEY)
  const lang = parseSettings(stored[SETTINGS_KEY]).transcriptionLanguage
  const audio = await readOpfs(audioPath)
  const transcriber = await transcriberFor(key, onProgress)
  try {
    // Leaves a core for the browser itself: WhatsApp keeps running beside this.
    const threads = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 2) - 1))
    let result: Awaited<ReturnType<FileTranscriber['transcribe']>>
    try {
      result = await transcriber.transcribe(
        new File([audio], 'sprachnachricht', { type: audio.type }),
        { lang, threads, suppress_non_speech: true, token_timestamps: false },
      )
    } catch {
      // The library swallows a decoding failure and hands whisper.cpp nothing; that is the only
      // way a transcription fails here on its own.
      throw new Error(t('transcription.error.audio'))
    }
    const lines = result.transcription
      .map((segment) => ({
        text: segment.text.trim(),
        startSeconds: segment.offsets.from / 1000,
        endSeconds: segment.offsets.to / 1000,
      }))
      .filter((line) => line.text !== '' && !/^\[.*\]$/.test(line.text))
    const text = lines.map((line) => line.text).join('\n')
    await store({
      op: 'storeTranscript',
      mediaId,
      text,
      lines,
      engine: 'whisper.cpp',
      engineVersion: `${key}-${MODELS[key].sha256.slice(0, 8)}`,
      lang: result.result.language,
    })
    return text
  } finally {
    releaseLater()
  }
}
