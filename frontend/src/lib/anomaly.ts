import { MIN_SCANS_FOR_ANOMALIES, SCORED_KEYS, SIGNALS } from './config';
import { usedValues } from './scoring';
import { fmtNum, toDisplay, unitFor } from './units';
import type { FeatureKind, Scan, ScanAnomaly, Settings, SignalKey } from './types';

export function median(a: number[]): number {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function quantile(a: number[], q: number): number {
  if (a.length === 0) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Robust scale estimate (MAD scaled to match a standard deviation for normal data). */
export function robustScale(a: number[], med: number): number {
  return 1.4826 * median(a.map((v) => Math.abs(v - med)));
}

/** Smallest change that is worth reporting, per signal, so tiny wobbles are never flagged. */
const MIN_DELTA: Partial<Record<SignalKey, number>> = {
  coolant_temp_c: 3, battery_v: 0.3, rpm: 150, intake_air_temp_c: 3,
};
/** Only changes in the unhealthy direction are flagged (a lower engine speed is not a health concern). */
const BAD_DIRECTION: Partial<Record<SignalKey, 'high' | 'low' | 'both'>> = {
  coolant_temp_c: 'high', battery_v: 'both', rpm: 'high', intake_air_temp_c: 'high',
};
const MIN_PCT_DELTA = 5;
const Z_LIMIT = 3.5;

export const FEATURE_LABEL: Record<FeatureKind, string> = {
  median: 'typical level', p95: 'high end (95th percentile)', pctAbnormal: 'share of time outside the normal range',
};

export function scanFeatures(scan: Scan): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of SCORED_KEYS) {
    const vals = usedValues(key, scan.series);
    if (vals.length === 0) continue;
    out[`${key}|median`] = median(vals);
    out[`${key}|p95`] = quantile(vals, 0.95);
    const sum = scan.signals.find((s) => s.key === key);
    if (sum) out[`${key}|pctAbnormal`] = sum.pctWatch + sum.pctAlert;
  }
  return out;
}

export interface AnomalyResult {
  enabled: boolean;
  scansNeeded: number;
  anomalies: ScanAnomaly[];
}

/**
 * Level 1 anomaly detection: robust z-score of each scan's features against the same vehicle's
 * other scans (leave-one-out). Needs MIN_SCANS_FOR_ANOMALIES scans, otherwise it stays off.
 */
export function detectAnomalies(scans: Scan[]): AnomalyResult {
  const sorted = [...scans].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  if (sorted.length < MIN_SCANS_FOR_ANOMALIES) {
    return { enabled: false, scansNeeded: MIN_SCANS_FOR_ANOMALIES - sorted.length, anomalies: [] };
  }
  const feats = sorted.map(scanFeatures);
  const anomalies: ScanAnomaly[] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (const key of SCORED_KEYS) {
      let best: ScanAnomaly | null = null;
      for (const feature of ['median', 'p95', 'pctAbnormal'] as FeatureKind[]) {
        const name = `${key}|${feature}`;
        const x = feats[i][name];
        if (x === undefined) continue;
        const others = feats.filter((_, j) => j !== i).map((f) => f[name]).filter((v) => v !== undefined);
        if (others.length < MIN_SCANS_FOR_ANOMALIES - 1) continue;
        const med = median(others);
        const isPct = feature === 'pctAbnormal';
        const minDelta = isPct ? MIN_PCT_DELTA : MIN_DELTA[key] ?? 0;
        const scale = Math.max(robustScale(others, med), isPct ? 2 : minDelta / 3, 1e-6);
        const z = (x - med) / scale;
        if (Math.abs(z) < Z_LIMIT || Math.abs(x - med) < minDelta) continue;
        if (isPct && z < 0) continue;
        const bad = BAD_DIRECTION[key] ?? 'both';
        if (!isPct && ((bad === 'high' && z < 0) || (bad === 'low' && z > 0))) continue;
        if (!best || Math.abs(z) > Math.abs(best.z)) {
          best = {
            scanId: sorted[i].id, signal: key, feature, value: x, baselineMedian: med,
            baselineLow: isPct ? Math.max(0, med - 2 * scale) : med - 2 * scale, baselineHigh: med + 2 * scale, z, direction: z > 0 ? 'high' : 'low',
          };
        }
      }
      if (best) anomalies.push(best);
    }
  }
  return { enabled: true, scansNeeded: 0, anomalies };
}

/** Plain-language one-liner for an anomaly, in the user's display units. */
export function describeAnomaly(a: ScanAnomaly, s: Pick<Settings, 'tempUnit'>): string {
  const cfg = SIGNALS[a.signal];
  const pct = a.feature === 'pctAbnormal';
  const unit = pct ? '%' : ` ${unitFor(a.signal, s)}`;
  const f = (v: number) => `${pct ? fmtNum(v) : fmtNum(toDisplay(a.signal, v, s), a.signal)}${unit}`;
  const which = FEATURE_LABEL[a.feature];
  const dir = a.direction === 'high' ? 'higher' : 'lower';
  return `${cfg.label} ${which} was ${f(a.value)}, ${dir} than this vehicle's usual ${f(a.baselineMedian)} (usual range ${f(a.baselineLow)} to ${f(a.baselineHigh)}).`;
}

/** Within-scan outliers: points that jump away from a running average by more than k running deviations. */
export function ewmaOutliers(values: number[], alpha = 0.2, k = 4, warmup = 8): number[] {
  const flagged: number[] = [];
  if (values.length < warmup + 2) return flagged;
  let ew = values[0];
  let variance = 0;
  for (let i = 1; i < values.length; i++) {
    const r = values[i] - ew;
    const sd = Math.sqrt(variance);
    if (i >= warmup && sd > 0 && Math.abs(r) > k * sd) flagged.push(i);
    else variance = (1 - alpha) * variance + alpha * r * r;
    ew = ew + alpha * (values[i] - ew);
  }
  return flagged;
}
