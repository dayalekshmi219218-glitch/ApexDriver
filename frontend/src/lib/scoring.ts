import {
  ALERT_PCT, IDLE_RPM, IDLE_THROTTLE, RUNNING_RPM, SCORED_KEYS, SIGNALS, SIGNAL_ORDER, TOTAL_SCORED_SIGNALS, WARMUP_C, WATCH_PCT,
  type ScoreCfg,
} from './config';
import type { EngineStates, MixtureSummary, Severity, SignalKey, SignalSummary } from './types';

const FLOOR = 10;
/** Overall score = 60% weighted mean + 40% worst scored signal. Deviation from the Android scorer: see README. */
export const WEIGHTED_MEAN_SHARE = 0.6;
/** Highest overall score allowed while any scored signal is in Alert (keeps the gauge from contradicting the table). */
export const ALERT_CAP = 79;

/**
 * Per-sample score 0-100. Port of the Android ScoreCalculator.scoreForPid:
 * normal = 100, moderate band interpolates 100 -> 60, critical band 60 -> 10.
 * One deliberate difference: the Android "low" branch never interpolated (its guard
 * `to > from` is always false), so every value in the low-moderate band scored a flat 60.
 * Here the band is interpolated correctly.
 */
export function scoreSample(value: number, cfg: ScoreCfg): number {
  if (!Number.isFinite(value)) return NaN;
  const inNormal =
    (cfg.normalMin === undefined || value >= cfg.normalMin) && (cfg.normalMax === undefined || value <= cfg.normalMax);
  if (inNormal) return 100;

  switch (cfg.direction) {
    case 'high': {
      const normalUpper = cfg.normalMax ?? Infinity;
      if (cfg.moderateMax !== undefined && value <= cfg.moderateMax && value > normalUpper) {
        const t = cfg.moderateMax > normalUpper ? clamp01((value - normalUpper) / (cfg.moderateMax - normalUpper)) : 1;
        return 100 - t * 40;
      }
      const critStart = cfg.criticalHigh ?? cfg.moderateMax ?? normalUpper;
      if (value >= critStart) {
        const t = value > critStart ? clamp01((value - critStart) / Math.max(1, critStart)) : 0;
        return 60 - t * (60 - FLOOR);
      }
      return 100;
    }
    case 'low': {
      const normalLower = cfg.normalMin ?? -Infinity;
      if (cfg.moderateMin !== undefined && value >= cfg.moderateMin && value < normalLower) {
        const t = normalLower > cfg.moderateMin ? clamp01((normalLower - value) / (normalLower - cfg.moderateMin)) : 1;
        return 100 - t * 40;
      }
      const critStart = cfg.criticalLow ?? cfg.moderateMin ?? normalLower;
      if (value <= critStart) {
        const t = critStart !== 0 ? clamp01((critStart - value) / Math.abs(critStart)) : 1;
        return 60 - t * (60 - FLOOR);
      }
      return 100;
    }
    case 'both': {
      const hi = scoreSample(value, { ...cfg, direction: 'high' });
      const lo = scoreSample(value, { ...cfg, direction: 'low' });
      return Math.min(hi, lo);
    }
    default:
      return 100;
  }
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export function bandOfScore(score: number): Severity {
  if (score >= 99.5) return 'normal';
  if (score >= 60) return 'watch';
  return 'alert';
}

/** Overall-score severity used for gauges and the ranking: 80+ Normal, 60-79 Watch, below 60 Alert. */
export function severityForScore(score: number): Severity {
  if (score >= 80) return 'normal';
  if (score >= 60) return 'watch';
  return 'alert';
}

export function severityLabel(s: Severity): string {
  return s === 'normal' ? 'Normal' : s === 'watch' ? 'Watch' : s === 'alert' ? 'Alert' : 'No data';
}

export function engineStates(series: Partial<Record<SignalKey, number[]>>): EngineStates {
  const coolant = series.coolant_temp_c;
  const rpm = series.rpm;
  const throttle = series.throttle_pct;
  if (!coolant || !rpm) return { warmup: 0, idle: 0, driving: 0 };
  const n = Math.min(coolant.length, rpm.length);
  let w = 0, i = 0, d = 0;
  for (let k = 0; k < n; k++) {
    if (rpm[k] <= RUNNING_RPM) continue;
    if (coolant[k] < WARMUP_C) w++;
    else if (rpm[k] < IDLE_RPM && (throttle ? throttle[k] : 0) < IDLE_THROTTLE) i++;
    else d++;
  }
  const total = w + i + d || 1;
  return { warmup: (w / total) * 100, idle: (i / total) * 100, driving: (d / total) * 100 };
}

export function sampleMask(
  key: SignalKey,
  series: Partial<Record<SignalKey, number[]>>,
  n: number,
): boolean[] {
  const cfg = SIGNALS[key];
  const rpm = series.rpm;
  const coolant = series.coolant_temp_c;
  const mask: boolean[] = [];
  for (let k = 0; k < n; k++) {
    const running = rpm ? rpm[k] > RUNNING_RPM : true;
    if (cfg.state === 'all') mask.push(true);
    else if (cfg.state === 'running') mask.push(running);
    else mask.push(running && (coolant ? coolant[k] >= WARMUP_C : true));
  }
  return mask;
}

/** Samples of a signal that count for scoring (after warm-up / while running). */
export function usedValues(key: SignalKey, series: Partial<Record<SignalKey, number[]>>): number[] {
  const values = series[key];
  if (!values) return [];
  const mask = sampleMask(key, series, values.length);
  return values.filter((v, k) => mask[k] && Number.isFinite(v));
}

export function summarizeSignal(key: SignalKey, series: Partial<Record<SignalKey, number[]>>): SignalSummary {
  const cfg = SIGNALS[key];
  const values = series[key];
  const empty: SignalSummary = {
    key, label: cfg.label, unit: cfg.unit, available: false, scored: cfg.scored, weight: cfg.weight,
    min: 0, avg: 0, max: 0, pctNormal: 0, pctWatch: 0, pctAlert: 0, score: null, severity: 'none',
  };
  if (!values || values.length === 0) return empty;
  const mask = sampleMask(key, series, values.length);
  const used: number[] = [];
  for (let k = 0; k < values.length; k++) if (mask[k] && Number.isFinite(values[k])) used.push(values[k]);
  if (used.length === 0) return empty;

  let sum = 0, min = Infinity, max = -Infinity, nNormal = 0, nWatch = 0, nAlert = 0, scoreSum = 0;
  for (const v of used) {
    sum += v; min = Math.min(min, v); max = Math.max(max, v);
    if (cfg.scored) {
      const s = scoreSample(v, cfg.cfg);
      scoreSum += s;
      const band = bandOfScore(s);
      if (band === 'normal') nNormal++; else if (band === 'watch') nWatch++; else nAlert++;
    }
  }
  const n = used.length;
  const base = { ...empty, available: true, min, avg: sum / n, max };
  if (!cfg.scored) return base;
  const pctNormal = (nNormal / n) * 100, pctWatch = (nWatch / n) * 100, pctAlert = (nAlert / n) * 100;
  const severity: Severity = pctAlert >= ALERT_PCT ? 'alert' : pctWatch + pctAlert >= WATCH_PCT ? 'watch' : 'normal';
  return { ...base, pctNormal, pctWatch, pctAlert, score: scoreSum / n, severity };
}

export interface ScanSummary {
  signals: SignalSummary[];
  score: number;
  severity: Severity;
  scoredSignals: number;
  totalSignals: number;
  states: EngineStates;
  mixture: MixtureSummary | null;
}

export function summarizeScan(series: Partial<Record<SignalKey, number[]>>): ScanSummary {
  const signals = SIGNAL_ORDER.map((k) => summarizeSignal(k, series));
  let wSum = 0, sSum = 0, count = 0, worst = 100;
  for (const s of signals) {
    if (s.scored && s.available && s.score !== null) {
      wSum += s.weight; sSum += s.score * s.weight; count++; worst = Math.min(worst, s.score);
    }
  }
  // Signals with no data are NOT scored as healthy (the Android app did that).
  // Weakest-link blend: a single failing signal must be able to pull the overall score down,
  // which a pure weighted mean cannot do when the other signals are fine.
  const blended = WEIGHTED_MEAN_SHARE * (sSum / wSum) + (1 - WEIGHTED_MEAN_SHARE) * worst;
  // The overall result may not read "Normal" while any signal is in Alert.
  const anyAlert = signals.some((x) => x.scored && x.severity === 'alert');
  const score = wSum > 0 ? Math.round(anyAlert ? Math.min(blended, ALERT_CAP) : blended) : 0;
  return {
    signals, score, severity: count === 0 ? 'none' : severityForScore(score),
    scoredSignals: count, totalSignals: TOTAL_SCORED_SIGNALS,
    states: engineStates(series), mixture: summarizeMixture(series),
  };
}

export function summarizeMixture(series: Partial<Record<SignalKey, number[]>>): MixtureSummary | null {
  const afr = series.afr;
  if (!afr || afr.length === 0) return null;
  const rpm = series.rpm;
  const vals = afr.filter((_, k) => (rpm ? rpm[k] > RUNNING_RPM : true));
  if (vals.length === 0) return null;
  const sorted = [...vals].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const rich = vals.filter((v) => v < 12.5).length;
  const lean = vals.filter((v) => v > 15.5).length;
  const n = vals.length;
  return { median, pctRich: (rich / n) * 100, pctLean: (lean / n) * 100, pctInRange: ((n - rich - lean) / n) * 100 };
}

export { SCORED_KEYS };
