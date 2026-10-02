import { useEffect, type ReactNode } from 'react'
import { initials } from './format'
import { CloseIcon } from './icons'

/**
 * The panel's building blocks. Few on purpose: one kind of button, one kind of card, one kind of
 * switch — an interface reads as calm when the same thing always looks the same.
 */

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  title,
  type = 'button',
}: {
  children: ReactNode
  onClick?: (() => void) | undefined
  variant?: 'primary' | 'secondary' | 'ghost'
  disabled?: boolean | undefined
  title?: string | undefined
  type?: 'button' | 'submit'
}): React.JSX.Element {
  const style = {
    primary: 'bg-wa-accent text-white hover:brightness-110',
    secondary: 'bg-wa-raised text-wa-text hover:bg-wa-hairline',
    ghost: 'text-wa-accent hover:bg-wa-accent-soft',
  }[variant]
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${style}`}
    >
      {children}
    </button>
  )
}

export function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-wa-muted transition hover:bg-wa-raised hover:text-wa-text"
    >
      {children}
    </button>
  )
}

export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3 py-1 text-xs transition ${
        active
          ? 'border-wa-accent bg-wa-accent-soft font-medium text-wa-accent'
          : 'border-wa-hairline text-wa-muted hover:border-wa-muted hover:text-wa-text'
      }`}
    >
      {children}
    </button>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => {
        onChange(!checked)
      }}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition ${
        checked ? 'bg-wa-accent' : 'bg-wa-hairline'
      }`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${
          checked ? 'translate-x-[18px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

export function Card({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string | undefined
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className="rounded-2xl bg-wa-surface p-4 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <h2 className="text-[13px] font-semibold text-wa-text">{title}</h2>
      {hint && <p className="mt-1 text-xs leading-relaxed text-wa-muted">{hint}</p>}
      <div className="mt-3 divide-y divide-wa-hairline">{children}</div>
    </section>
  )
}

export function SettingRow({
  label,
  hint,
  control,
}: {
  label: string
  hint?: string | undefined
  control: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-[13px] text-wa-text">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-snug text-wa-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}): React.JSX.Element {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 rounded-full bg-wa-raised p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => {
            onChange(option.value)
          }}
          className={`flex-1 rounded-full px-2 py-1 text-xs transition ${
            option.value === value
              ? 'bg-wa-surface font-medium text-wa-text shadow-sm'
              : 'text-wa-muted hover:text-wa-text'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title?: string | undefined
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-wa-accent-soft text-wa-accent">
        {icon}
      </div>
      {title && <h2 className="text-sm font-semibold text-wa-text">{title}</h2>}
      {children && <div className="mt-1.5 text-xs leading-relaxed text-wa-muted">{children}</div>}
    </div>
  )
}

export function Spinner(): React.JSX.Element {
  return (
    <span
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-wa-hairline border-t-wa-accent"
      aria-hidden="true"
    />
  )
}

const AVATAR_COLOURS = ['#00a884', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444', '#14b8a6', '#6366f1']

export function Avatar({ name, size = 40 }: { name: string; size?: number }): React.JSX.Element {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) | 0
  const colour = AVATAR_COLOURS[Math.abs(hash) % AVATAR_COLOURS.length]
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: colour, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </span>
  )
}

/** A panel that slides up over the view. Escape and the backdrop close it. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end bg-black/30" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="max-h-[85vh] overflow-y-auto rounded-t-3xl bg-wa-panel p-4 pb-6 shadow-2xl"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          <IconButton label="Schließen" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </div>
        {children}
      </div>
    </div>
  )
}

/** A word highlighted wherever a search term (in any spelling of its letters) appears. */
export function Highlight({
  text,
  terms,
}: {
  text: string
  terms: readonly string[]
}): React.JSX.Element {
  const words = terms
    .map((term) => term.replace(/^"|"$/g, '').trim())
    .filter((term) => term.length > 1)
  if (words.length === 0) return <>{text}</>
  const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'))
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className="rounded-sm bg-wa-accent-soft px-0.5 text-wa-text">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}
