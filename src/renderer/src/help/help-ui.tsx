import { createContext, useContext, type ReactNode } from 'react'
import { tokenizeHelp } from '@shared/help/content'
import { helpArticle, type HelpTopic } from './articles'

/**
 * The way from any place in the panel to the help: a "?" beside a section heading, a "Mehr dazu"
 * after a sentence. Both open the article for that place in the "Hilfe" tab, so the one sentence
 * the panel shows can stay one sentence.
 */

const OpenHelp = createContext<(topic: HelpTopic) => void>(() => undefined)

export const HelpProvider = OpenHelp.Provider

export function useOpenHelp(): (topic: HelpTopic) => void {
  return useContext(OpenHelp)
}

export function HelpIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M9.6 9.4a2.5 2.5 0 0 1 4.9.8c0 1.7-2.5 2.2-2.5 3.8M12 17h.01"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** A small "?" that opens the article on what sits beside it. */
export function HelpButton({ topic }: { topic: HelpTopic }): React.JSX.Element {
  const open = useOpenHelp()
  const label = `Hilfe: ${helpArticle(topic).title}`
  return (
    <button
      type="button"
      onClick={() => {
        open(topic)
      }}
      aria-label={label}
      title={label}
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-wa-muted hover:bg-wa-raised hover:text-wa-accent"
    >
      <HelpIcon className="h-3.5 w-3.5" />
    </button>
  )
}

/** "Mehr dazu" after a sentence. */
export function HelpLink({
  topic,
  children,
}: {
  topic: HelpTopic
  children?: ReactNode
}): React.JSX.Element {
  const open = useOpenHelp()
  return (
    <button
      type="button"
      onClick={() => {
        open(topic)
      }}
      className="font-medium text-wa-accent hover:underline"
    >
      {children ?? 'Mehr dazu'}
    </button>
  )
}

/** The help's inline markup (src/shared/help/content.ts). No HTML is ever interpreted. */
export function RichText({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {tokenizeHelp(text).map((token, i) => {
        if (token.kind === 'bold') return <strong key={i}>{token.text}</strong>
        if (token.kind === 'label')
          return (
            <strong key={i} className="font-semibold text-wa-text">
              {token.text}
            </strong>
          )
        if (token.kind === 'code')
          return (
            <code key={i} className="rounded bg-wa-raised px-1 py-0.5 text-[0.95em] text-wa-text">
              {token.text}
            </code>
          )
        return token.text
      })}
    </>
  )
}
