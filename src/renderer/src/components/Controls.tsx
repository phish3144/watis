import type { ReactNode } from 'react'

export function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h2>
      <div className="space-y-1 rounded-lg bg-wa-surface p-3">{children}</div>
    </section>
  )
}

export function Row({
  label,
  hint,
  control,
}: {
  label: string
  hint?: string | undefined
  control: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-slate-200">{label}</div>
        {hint && <div className="mt-0.5 text-xs leading-snug text-slate-500">{hint}</div>}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
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
      className={`relative h-5 w-9 rounded-full transition-colors ${
        checked ? 'bg-wa-accent' : 'bg-slate-600'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
          checked ? 'left-4.5' : 'left-0.5'
        }`}
      />
    </button>
  )
}

export function NumberField({
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  label,
}: {
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step: number
  suffix?: string | undefined
  label: string
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          onChange(Number(event.target.value))
        }}
        className="w-24 accent-wa-accent"
      />
      <span className="w-14 text-right font-mono text-xs text-slate-400">
        {value}
        {suffix ?? ''}
      </span>
    </div>
  )
}

export function TextField({
  value,
  onChange,
  label,
  placeholder,
  width = 'w-40',
}: {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string | undefined
  width?: string
}): React.JSX.Element {
  return (
    <input
      type="text"
      aria-label={label}
      value={value}
      placeholder={placeholder}
      onChange={(event) => {
        onChange(event.target.value)
      }}
      className={`${width} rounded border border-slate-600 bg-slate-800 px-2 py-1 font-mono text-xs text-slate-200 focus:border-wa-accent focus:outline-none`}
    />
  )
}

export function TimeField({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (value: string) => void
  label: string
}): React.JSX.Element {
  return (
    <input
      type="time"
      aria-label={label}
      value={value}
      onChange={(event) => {
        onChange(event.target.value)
      }}
      className="rounded border border-slate-600 bg-slate-800 px-2 py-1 font-mono text-xs text-slate-200 focus:border-wa-accent focus:outline-none"
    />
  )
}
