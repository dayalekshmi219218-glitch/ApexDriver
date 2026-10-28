import clsx from 'clsx';
import { Link } from 'react-router-dom';
import { fmtShortDate } from '../lib/units';
import type { Scan, Severity, Vehicle } from '../lib/types';

export interface RankRow {
  vehicle: Vehicle;
  scan: Scan | null;
}

const bar: Record<Severity, string> = {
  normal: 'bg-sev-normal', watch: 'bg-sev-watch', alert: 'bg-sev-alert', none: 'bg-sev-none',
};

/** Healthiest to least healthy. Each bar shows how many signals the score is based on, so thin data cannot pass as strong data. */
export function RankedBars({ rows }: { rows: RankRow[] }) {
  const sorted = [...rows].sort((a, b) => {
    if (!a.scan && !b.scan) return 0;
    if (!a.scan) return 1;
    if (!b.scan) return -1;
    return b.scan.score - a.scan.score || b.scan.scoredSignals - a.scan.scoredSignals;
  });
  return (
    <ol className="space-y-3">
      {sorted.map((r, i) => (
        <li key={r.vehicle.id}>
          <Link to={`/vehicles/${r.vehicle.id}`} className="group block rounded-xl p-2 transition hover:bg-surface2">
            <div className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface3 text-xs font-bold text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">
                    {r.vehicle.name}
                    {r.vehicle.modelYear && <span className="ml-1.5 font-normal text-muted">{r.vehicle.modelYear}</span>}
                  </span>
                  <span className="font-display text-lg font-bold tabular-nums">{r.scan ? r.scan.score : '-'}</span>
                </div>
                <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-surface3">
                  {r.scan && (
                    <div className={clsx('h-full rounded-full transition-all duration-700', bar[r.scan.severity])} style={{ width: `${r.scan.score}%` }} />
                  )}
                </div>
                <div className="mt-1 flex justify-between text-xs text-muted">
                  <span>{r.scan ? `Based on ${r.scan.scoredSignals} of ${r.scan.totalSignals} signals` : 'No scans yet'}</span>
                  {r.scan && <span>Last scan {fmtShortDate(r.scan.startedAt)}</span>}
                </div>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ol>
  );
}
