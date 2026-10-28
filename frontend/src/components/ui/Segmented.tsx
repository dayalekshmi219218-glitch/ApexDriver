import clsx from 'clsx';

export function Segmented<T extends string>({
  value, options, onChange, label,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl border border-border bg-surface2 p-1">
      {options.map((o) => (
        <button
          key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition',
            value === o.value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
