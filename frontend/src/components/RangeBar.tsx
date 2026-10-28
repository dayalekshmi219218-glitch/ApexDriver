import clsx from 'clsx';
import { SIGNALS } from '../lib/config';
import { fmtNum, toDisplay } from '../lib/units';
import type { Settings, SignalSummary } from '../lib/types';

const zoneColor = {
  normal: 'bg-sev-normal/40', watch: 'bg-sev-watch/50', alert: 'bg-sev-alert/50', none: 'bg-sev-none/25',
} as const;

/** Shows where a signal actually sat (min to max, with the average) against its normal / watch / alert zones. */
export function RangeBar({ sig, settings }: { sig: SignalSummary; settings: Pick<Settings, 'tempUnit'> }) {
  const cfg = SIGNALS[sig.key];
  const [d0, d1] = cfg.domain;
  const pos = (v: number) => Math.min(100, Math.max(0, ((v - d0) / (d1 - d0)) * 100));
  const lab = (v: number) => fmtNum(toDisplay(sig.key, v, settings), sig.key);
  return (
    <div className="w-full min-w-[140px]">
      <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-surface3">
        {cfg.zones.map((z, i) => (
          <div key={i} className={clsx('absolute inset-y-0', zoneColor[z.sev])} style={{ left: `${pos(z.from)}%`, width: `${pos(z.to) - pos(z.from)}%` }} />
        ))}
      </div>
      {sig.available && (
        <div className="relative -mt-[9px] h-2.5" aria-hidden>
          <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded bg-ink/70" style={{ left: `${pos(sig.min)}%`, width: `${Math.max(0.8, pos(sig.max) - pos(sig.min))}%` }} />
          <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-ink shadow" style={{ left: `${pos(sig.avg)}%` }} />
        </div>
      )}
      <div className="mt-1.5 flex justify-between text-[10px] text-muted">
        <span>{lab(d0)}</span>
        <span>{lab(d1)}</span>
      </div>
    </div>
  );
}
