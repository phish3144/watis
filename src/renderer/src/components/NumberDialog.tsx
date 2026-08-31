import { useState } from 'react'
import { api } from '../api'
import { t } from '../i18n'

/**
 * Opens a chat with a number that is not in the address book (PLAN.md Phase 8).
 *
 * The official client makes this genuinely awkward — save the contact, wait for it to sync, find
 * it. This takes a number or a wa.me link and goes straight to WhatsApp's own `/send` URL, which
 * means no part of it reaches into the internals: opening a chat by number is something the web
 * client supports on its own.
 */
export function NumberDialog(): React.JSX.Element {
  const [input, setInput] = useState('')
  const [problem, setProblem] = useState<string | undefined>(undefined)

  const open = (): void => {
    setProblem(undefined)
    void api()
      .openNumber(input)
      .then((result) => {
        if (result.ok) setInput('')
        else setProblem(result.reason)
      })
      .catch((error: unknown) => {
        setProblem(String(error))
      })
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => {
            setInput(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') open()
          }}
          placeholder="+49 151 2345678 oder wa.me/49151…"
          aria-label={t('section.number')}
          className="flex-1 rounded-md border border-wa-hairline bg-transparent px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={input.trim() === ''}
          onClick={open}
          className="rounded-md border border-wa-hairline px-2 py-1 text-xs disabled:opacity-40"
        >
          {t('number.open')}
        </button>
      </div>
      <p className="text-[11px] text-slate-500">{t('number.hint')}</p>
      {problem !== undefined && <p className="text-[11px] text-red-400">{problem}</p>}
    </div>
  )
}
