import { Area, AreaChart, CartesianGrid, ReferenceArea, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { SIGNALS } from '../lib/config';
import { ewmaOutliers } from '../lib/anomaly';
import type { SignalKey } from '../lib/types';
import { alpha, useChartColors } from './useChartColors';

interface Pt { minute: number; value: number }

/** One scan's time series for one signal, with the normal / watch / alert zones shaded behind it. */
export function SeriesChart({ signal, values, durationMin, unit, convert }: {
  signal: SignalKey; values: number[]; durationMin: number; unit: string; convert: (v: number) => number;
}) {
  const c = useChartColors();
  const cfg = SIGNALS[signal];
  const data: Pt[] = values.map((v, i) => ({ minute: Math.round(((i * durationMin) / values.length) * 10) / 10, value: convert(v) }));
  const outliers = ewmaOutliers(values);
  const lo = Math.min(...data.map((d) => d.value)), hi = Math.max(...data.map((d) => d.value));
  const pad = Math.max((hi - lo) * 0.15, 0.5);
  const zoneFill = { normal: alpha(c.normal, 0.10), watch: alpha(c.watch, 0.16), alert: alpha(c.alert, 0.16), none: 'transparent' } as const;
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 14, bottom: 4, left: 0 }}>
          <defs>
            <linearGradient id={`area-${signal}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c.primary} stopOpacity={0.35} />
              <stop offset="100%" stopColor={c.primary} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={alpha(c.muted, 0.18)} vertical={false} />
          {cfg.scored && cfg.zones.map((z, i) => (
            <ReferenceArea key={i} y1={convert(z.from)} y2={convert(z.to)} fill={zoneFill[z.sev]} ifOverflow="hidden" />
          ))}
          <XAxis dataKey="minute" type="number" domain={[0, durationMin]} tick={{ fill: c.muted, fontSize: 12 }} tickLine={false}
            axisLine={{ stroke: alpha(c.muted, 0.3) }} tickFormatter={(m: number) => `${Math.round(m)}m`} />
          <YAxis domain={[lo - pad, hi + pad]} width={52} tick={{ fill: c.muted, fontSize: 12 }} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1))} />
          <Tooltip content={<SeriesTip unit={unit} />} />
          <Area type="monotone" dataKey="value" stroke={c.primary} strokeWidth={2} fill={`url(#area-${signal})`} isAnimationActive={false} />
          {outliers.map((i) => (
            <ReferenceDot key={i} x={data[i].minute} y={data[i].value} r={5} fill={c.alert} stroke={c.surface} strokeWidth={2} ifOverflow="visible" />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function SeriesTip({ active, payload, unit }: { active?: boolean; payload?: { payload: Pt }[]; unit: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card !bg-surface px-3 py-2 text-xs shadow-card">
      <div className="font-semibold">Minute {Math.round(p.minute)}</div>
      <div className="mt-0.5 text-muted">{p.value.toFixed(Math.abs(p.value) >= 100 ? 0 : 1)} {unit}</div>
    </div>
  );
}
