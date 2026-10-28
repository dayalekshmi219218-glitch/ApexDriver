export type SignalKey =
  | 'coolant_temp_c'
  | 'battery_v'
  | 'rpm'
  | 'intake_air_temp_c'
  | 'throttle_pct'
  | 'load_kpa'
  | 'ignition_deg'
  | 'afr';

/** none = "No data" (or contextual signal that is shown but not scored) */
export type Severity = 'normal' | 'watch' | 'alert' | 'none';

export interface User {
  id: string;
  name: string;
  email: string;
  demo: boolean;
}

export interface Vehicle {
  id: string;
  name: string;
  modelYear: number | null;
  createdAt: string;
  synthetic: boolean;
}

export interface SignalSummary {
  key: SignalKey;
  label: string;
  unit: string;
  available: boolean;
  scored: boolean;
  weight: number;
  min: number;
  avg: number;
  max: number;
  /** percent of the relevant engine state spent in each band (0-100) */
  pctNormal: number;
  pctWatch: number;
  pctAlert: number;
  /** time-weighted mean of per-sample scores, null when not scored or no data */
  score: number | null;
  severity: Severity;
}

export interface MixtureSummary {
  median: number;
  pctRich: number;
  pctInRange: number;
  pctLean: number;
}

export interface EngineStates {
  warmup: number;
  idle: number;
  driving: number;
}

export type FeatureKind = 'median' | 'p95' | 'pctAbnormal';

export interface ScanAnomaly {
  scanId: string;
  signal: SignalKey;
  feature: FeatureKind;
  value: number;
  baselineMedian: number;
  baselineLow: number;
  baselineHigh: number;
  z: number;
  direction: 'high' | 'low';
}

export interface Scan {
  id: string;
  vehicleId: string;
  startedAt: string;
  durationMin: number;
  source: string;
  fileName: string;
  /** true while results are produced by the in-browser simulator instead of the backend */
  simulated: boolean;
  score: number;
  severity: Severity;
  scoredSignals: number;
  totalSignals: number;
  states: EngineStates;
  signals: SignalSummary[];
  /** downsampled time series, SERIES_POINTS values per signal */
  series: Partial<Record<SignalKey, number[]>>;
  mixture: MixtureSummary | null;
}

export type ExplainLevel = 'simple' | 'technical';
export type ThemeChoice = 'dark' | 'light' | 'system';

export interface Settings {
  tempUnit: 'C' | 'F';
  speedUnit: 'kmh' | 'mph';
  explainLevel: ExplainLevel;
  theme: ThemeChoice;
}

export interface Evidence {
  id: string;
  text: string;
  numbers: number[];
}

export interface ExplanationFinding {
  signal: string;
  text: string;
  severity: Severity;
  evidence: string[];
}

export interface ExplanationStep {
  text: string;
  urgency: 'low' | 'medium' | 'high';
}

export interface Explanation {
  headline: string;
  summary: string;
  findings: ExplanationFinding[];
  meaning: string;
  steps: ExplanationStep[];
  questions: string[];
  caveats: string[];
  evidence: Evidence[];
  level: ExplainLevel;
  model: string;
  faithfulness: { checked: number; matched: number; unmatched: number[] };
}

export const SERIES_POINTS = 120;
