import type { EngineStates } from '../lib/types';

const parts = [
  { key: 'warmup', label: 'Warm-up', cls: 'bg-sev-watch/60' },
  { key: 'idle', label: 'Idle', cls: 'bg-accent/70' },
  { key: 'driving', label: 'Driving', cls: 'bg-primary' },
] as const;

export function StateBar({ states }: { states: EngineStates }) {
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface3" role="img"
        aria-label={`Warm-up ${Math.round(states.warmup)} percent, idle ${Math.round(states.idle)} percent, driving ${Math.round(states.driving)} percent`}>
        {parts.map((p) => (
          <div key={p.key} className={p.cls} style={{ width: `${states[p.key]}%` }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${p.cls}`} />
            {p.label} <b className="font-semibold text-ink">{Math.round(states[p.key])}%</b>
          </span>
        ))}
      </div>
    </div>
  );
}
