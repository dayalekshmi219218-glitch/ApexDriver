import { useEffect, useState } from 'react';
import { severityLabel } from '../lib/scoring';
import type { Severity } from '../lib/types';

/** 270-degree health gauge (same geometry as the app icon). Animates from 0 on mount. */
export function Gauge({ value, severity, size = 220, caption, showLabel = true }: {
  value: number; severity: Severity; size?: number; caption?: string; showLabel?: boolean;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(value));
    return () => cancelAnimationFrame(id);
  }, [value]);
  const stroke = size * 0.075;
  const r = size / 2 - stroke - 6;
  const c = size / 2;
  const xy = (deg: number): [number, number] => [c + r * Math.cos((deg * Math.PI) / 180), c + r * Math.sin((deg * Math.PI) / 180)];
  const [x1, y1] = xy(135);
  const [x2, y2] = xy(45);
  const d = `M ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2}`;
  const len = r * ((270 * Math.PI) / 180);
  const color = `rgb(var(--sev-${severity}))`;
  return (
    <div className="relative inline-block" style={{ width: size, height: size }} role="img" aria-label={`Health score ${value} out of 100, ${severityLabel(severity)}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <path d={d} fill="none" strokeLinecap="round" strokeWidth={stroke} style={{ stroke: 'rgb(var(--surface3))' }} />
        <path
          d={d} fill="none" strokeLinecap="round" strokeWidth={stroke}
          strokeDasharray={`${(len * Math.max(0, Math.min(100, shown))) / 100} ${len}`}
          style={{ stroke: color, filter: `drop-shadow(0 0 ${size * 0.04}px ${color})`, transition: 'stroke-dasharray 1s cubic-bezier(.22,.8,.3,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display font-bold leading-none" style={{ fontSize: size * 0.28 }}>{value}</span>
        <span className="mt-1 text-muted" style={{ fontSize: size * 0.065 }}>{caption ?? 'out of 100'}</span>
        {showLabel && (
          <span className="mt-2 rounded-full px-3 py-0.5 font-semibold" style={{ fontSize: size * 0.065, color, background: 'rgb(var(--surface2))' }}>
            {severityLabel(severity)}
          </span>
        )}
      </div>
    </div>
  );
}
