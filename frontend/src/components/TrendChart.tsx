import { CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { alpha, useChartColors } from './useChartColors';

export interface TrendPoint {
  scanId: string;
  label: string;
  value: number;
  anomaly: boolean;
}

interface DotProps { cx?: number; cy?: number; payload?: TrendPoint }

export function TrendChart({ points, baseline, unit, onSelect, selectedId }: {
  points: TrendPoint[]; baseline: { low: number; high: number } | null; unit: string;
  onSelect?: (scanId: string) => void; selectedId?: string;
}) {
  const c = useChartColors();
  const vals = points.map((p) => p.value);
  const lo = Math.min(...vals, baseline?.low ?? Infinity);
  const hi = Math.max(...vals, baseline?.high ?? -Infinity);
  const pad = Math.max((hi - lo) * 0.18, 0.5);
  const dot = (p: DotProps) => {
    if (p.cx === undefined || p.cy === undefined || !p.payload) return <g />;
    const bad = p.payload.anomaly;
    const sel = p.payload.scanId === selectedId;
    return (
      <g key={p.payload.scanId} style={{ cursor: onSelect ? 'pointer' : 'default' }} onClick={() => onSelect?.(p.payload!.scanId)}>
        {bad && <circle cx={p.cx} cy={p.cy} r={11} fill={alpha(c.alert, 0.18)} />}
        <circle cx={p.cx} cy={p.cy} r={sel ? 6.5 : 5} fill={bad ? c.alert : c.primary} stroke={c.surface} strokeWidth={2} />
      </g>
    );
  };
  return (
    <div className="h-[290px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 12, right: 14, bottom: 4, left: 0 }}>
          <CartesianGrid stroke={alpha(c.muted, 0.18)} vertical={false} />
          {baseline && (
            <ReferenceArea y1={baseline.low} y2={baseline.high} fill={alpha(c.normal, 0.14)} stroke={alpha(c.normal, 0.4)} strokeDasharray="4 4" ifOverflow="extendDomain" />
          )}
          <XAxis dataKey="label" tick={{ fill: c.muted, fontSize: 12 }} tickLine={false} axisLine={{ stroke: alpha(c.muted, 0.3) }} />
          <YAxis domain={[lo - pad, hi + pad]} width={52} tick={{ fill: c.muted, fontSize: 12 }} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1))} />
          <Tooltip cursor={{ stroke: alpha(c.muted, 0.4) }} content={<TrendTip unit={unit} />} />
          <Line type="monotone" dataKey="value" stroke={c.primary} strokeWidth={2.5} dot={dot} activeDot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function TrendTip({ active, payload, unit }: { active?: boolean; payload?: { payload: TrendPoint }[]; unit: string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card !bg-surface px-3 py-2 text-xs shadow-card">
      <div className="font-semibold">{p.label}</div>
      <div className="mt-0.5 text-muted">{p.value.toFixed(Math.abs(p.value) >= 100 ? 0 : 1)} {unit}</div>
      {p.anomaly && <div className="mt-1 font-semibold text-pill-alert-fg">Unusual for this vehicle</div>}
    </div>
  );
}
