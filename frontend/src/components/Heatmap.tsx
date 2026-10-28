import { useMemo } from 'react';
import type { Scan } from '../lib/types';

const RPM_BINS: [number, number][] = [[600, 1000], [1000, 1500], [1500, 2000], [2000, 2500], [2500, 3000], [3000, 4000], [4000, 8000]];
const LOAD_BINS: [number, number][] = [[0, 25], [25, 40], [40, 55], [55, 70], [70, 85], [85, 110]];
const MIN_SAMPLES = 3;

function cellStyle(afr: number | null): { bg: string; fg: string } {
  if (afr === null) return { bg: 'transparent', fg: 'rgb(var(--subtle))' };
  if (afr < 12.5) {
    const a = Math.min(0.85, 0.25 + ((12.5 - afr) / 4) * 0.6);
    return { bg: `rgb(var(--primary) / ${a})`, fg: 'rgb(var(--text))' };
  }
  if (afr > 15.5) return { bg: 'rgb(var(--sev-watch) / 0.55)', fg: 'rgb(var(--text))' };
  return { bg: 'rgb(var(--sev-normal) / 0.5)', fg: 'rgb(var(--text))' };
}

/** Average air-fuel ratio by engine speed and load, pooled over all scans. A tuning indicator, not a health score. */
export function MixtureHeatmap({ scans }: { scans: Scan[] }) {
  const cells = useMemo(() => {
    const sum: number[][] = RPM_BINS.map(() => LOAD_BINS.map(() => 0));
    const cnt: number[][] = RPM_BINS.map(() => LOAD_BINS.map(() => 0));
    for (const s of scans) {
      const { rpm, load_kpa: load, afr } = s.series;
      if (!rpm || !load || !afr) continue;
      for (let i = 0; i < afr.length; i++) {
        const r = RPM_BINS.findIndex(([a, b]) => rpm[i] >= a && rpm[i] < b);
        const l = LOAD_BINS.findIndex(([a, b]) => load[i] >= a && load[i] < b);
        if (r < 0 || l < 0) continue;
        sum[r][l] += afr[i];
        cnt[r][l] += 1;
      }
    }
    return RPM_BINS.map((_, r) => LOAD_BINS.map((__, l) => (cnt[r][l] >= MIN_SAMPLES ? { afr: sum[r][l] / cnt[r][l], n: cnt[r][l] } : null)));
  }, [scans]);

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[420px]">
        <div className="mb-1 grid items-center gap-1 text-[10px] text-muted" style={{ gridTemplateColumns: `64px repeat(${LOAD_BINS.length}, 1fr)` }}>
          <span />
          {LOAD_BINS.map(([a, b]) => <span key={a} className="text-center">{a}-{b} kPa</span>)}
        </div>
        {RPM_BINS.map(([a, b], r) => (
          <div key={a} className="mb-1 grid items-stretch gap-1" style={{ gridTemplateColumns: `64px repeat(${LOAD_BINS.length}, 1fr)` }}>
            <span className="flex items-center text-[10px] text-muted">{a}-{b === 8000 ? '+' : b} rpm</span>
            {cells[r].map((cell, l) => {
              const st = cellStyle(cell ? cell.afr : null);
              return (
                <div key={l} className="flex h-9 items-center justify-center rounded-md border border-border/60 text-xs font-semibold"
                  style={{ background: st.bg, color: st.fg }} title={cell ? `${cell.afr.toFixed(1)}:1 from ${cell.n} readings` : 'Not enough data'}>
                  {cell ? cell.afr.toFixed(1) : ''}
                </div>
              );
            })}
          </div>
        ))}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-4 rounded bg-primary/60" /> richer than 12.5:1</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-4 rounded bg-sev-normal/50" /> 12.5 to 15.5:1</span>
          <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-4 rounded bg-sev-watch/55" /> leaner than 15.5:1</span>
        </div>
      </div>
    </div>
  );
}
