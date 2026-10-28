import type { Severity, SignalKey } from './types';

export interface Zone {
  from: number;
  to: number;
  sev: Severity;
}

/** Same shape as the Android pid_config.json entries, so the Python scorer can share it later. */
export interface ScoreCfg {
  direction: 'high' | 'low' | 'both' | 'neutral';
  normalMin?: number;
  normalMax?: number;
  moderateMin?: number;
  moderateMax?: number;
  criticalLow?: number;
  criticalHigh?: number;
}

export interface SignalConfig {
  key: SignalKey;
  label: string;
  unit: string;
  weight: number;
  scored: boolean;
  /** which samples are used: after warm-up, whenever the engine is running, or all */
  state: 'warmed' | 'running' | 'all';
  isTemp: boolean;
  domain: [number, number];
  zones: Zone[];
  cfg: ScoreCfg;
  plain: string;
  technical: string;
}

export const WARMUP_C = 70;
export const RUNNING_RPM = 600;
export const IDLE_RPM = 1000;
export const IDLE_THROTTLE = 4;
/** a signal turns Alert when this share of its time is in the Alert band, Watch at the lower share */
export const ALERT_PCT = 1;
export const WATCH_PCT = 5;
/** minimum scans before anomaly detection is allowed to flag anything */
export const MIN_SCANS_FOR_ANOMALIES = 8;

export const SIGNALS: Record<SignalKey, SignalConfig> = {
  coolant_temp_c: {
    key: 'coolant_temp_c', label: 'Coolant temperature', unit: '°C', weight: 6, scored: true, state: 'warmed', isTemp: true,
    domain: [40, 130],
    zones: [
      { from: 40, to: 105, sev: 'normal' },
      { from: 105, to: 120, sev: 'watch' },
      { from: 120, to: 130, sev: 'alert' },
    ],
    cfg: { direction: 'high', normalMin: 70, normalMax: 105, moderateMin: 105, moderateMax: 120, criticalHigh: 120 },
    plain: "How hot the engine's cooling liquid is. An engine runs best when warm, but too much heat can damage it.",
    technical: 'Engine coolant temperature (PID 05). Scored after warm-up (≥ 70 °C): Watch above 105 °C, Alert above 120 °C.',
  },
  battery_v: {
    key: 'battery_v', label: 'Battery voltage', unit: 'V', weight: 3.5, scored: true, state: 'running', isTemp: false,
    domain: [10, 16.5],
    zones: [
      { from: 10, to: 11.5, sev: 'alert' },
      { from: 11.5, to: 12, sev: 'watch' },
      { from: 12, to: 14.8, sev: 'normal' },
      { from: 14.8, to: 15.5, sev: 'watch' },
      { from: 15.5, to: 16.5, sev: 'alert' },
    ],
    cfg: { direction: 'both', normalMin: 12, normalMax: 14.8, moderateMin: 11.5, moderateMax: 15.5, criticalLow: 11.5, criticalHigh: 15.5 },
    plain: "The electrical level of the car's battery while the engine runs. Low readings can mean a tired battery or a weak charging system.",
    technical: 'Control module / battery voltage while running (RPM > 600). Watch 11.5-12.0 V or 14.8-15.5 V, Alert outside 11.5-15.5 V.',
  },
  rpm: {
    key: 'rpm', label: 'Engine speed', unit: 'rpm', weight: 5, scored: true, state: 'running', isTemp: false,
    domain: [0, 7500],
    zones: [
      { from: 0, to: 4000, sev: 'normal' },
      { from: 4000, to: 6000, sev: 'watch' },
      { from: 6000, to: 7500, sev: 'alert' },
    ],
    cfg: { direction: 'high', normalMin: 600, normalMax: 4000, moderateMin: 4000, moderateMax: 6000, criticalHigh: 6000 },
    plain: 'How fast the engine is turning. Short bursts of high speed are normal; long periods near the limit wear the engine.',
    technical: 'Engine speed (PID 0C), by share of running time. Watch above 4000 rpm, Alert above 6000 rpm.',
  },
  intake_air_temp_c: {
    key: 'intake_air_temp_c', label: 'Intake air temperature', unit: '°C', weight: 1.5, scored: true, state: 'running', isTemp: true,
    domain: [-10, 90],
    zones: [
      { from: -10, to: 50, sev: 'normal' },
      { from: 50, to: 70, sev: 'watch' },
      { from: 70, to: 90, sev: 'alert' },
    ],
    cfg: { direction: 'high', normalMin: -10, normalMax: 50, moderateMin: 50, moderateMax: 70, criticalHigh: 70 },
    plain: 'The temperature of the air going into the engine. Hot days and heat from the engine bay push it up; it matters less than other readings.',
    technical: 'Intake air temperature (PID 0F). Contextual, low weight. Watch above 50 °C, Alert above 70 °C (hot-climate caveat).',
  },
  throttle_pct: {
    key: 'throttle_pct', label: 'Throttle position', unit: '%', weight: 0, scored: false, state: 'running', isTemp: false,
    domain: [0, 100], zones: [{ from: 0, to: 100, sev: 'none' }], cfg: { direction: 'neutral' },
    plain: 'How far the accelerator is pressed. Shown for context, not scored.',
    technical: 'Throttle position (PID 11). Displayed for context; not scored in v1.',
  },
  load_kpa: {
    key: 'load_kpa', label: 'Engine load', unit: 'kPa', weight: 0, scored: false, state: 'running', isTemp: false,
    domain: [0, 110], zones: [{ from: 0, to: 110, sev: 'none' }], cfg: { direction: 'neutral' },
    plain: 'How hard the engine is working. Shown for context, not scored.',
    technical: 'Manifold pressure used as load. Displayed for context; not scored in v1.',
  },
  ignition_deg: {
    key: 'ignition_deg', label: 'Ignition timing', unit: '°', weight: 0, scored: false, state: 'running', isTemp: false,
    domain: [-10, 45], zones: [{ from: -10, to: 45, sev: 'none' }], cfg: { direction: 'neutral' },
    plain: 'When the spark fires, measured in degrees. Shown for context, not scored.',
    technical: 'Ignition timing advance (PID 0E). Displayed for context; not scored in v1.',
  },
  afr: {
    key: 'afr', label: 'Air-fuel ratio', unit: ':1', weight: 0, scored: false, state: 'running', isTemp: false,
    domain: [8, 18],
    zones: [
      { from: 8, to: 12.5, sev: 'watch' },
      { from: 12.5, to: 15.5, sev: 'normal' },
      { from: 15.5, to: 18, sev: 'watch' },
    ],
    cfg: { direction: 'neutral' },
    plain: 'The balance of fuel and air burned in the engine. Petrol engines aim for about 14.7 parts air to 1 part fuel.',
    technical: 'Wideband AFR. Shown as an unscored tuning indicator: reference 14.7:1 for petrol; scale and fuel type unverified.',
  },
};

export const SIGNAL_ORDER: SignalKey[] = [
  'coolant_temp_c', 'battery_v', 'rpm', 'intake_air_temp_c', 'throttle_pct', 'load_kpa', 'ignition_deg',
];
export const SCORED_KEYS = SIGNAL_ORDER.filter((k) => SIGNALS[k].scored);
export const TOTAL_SCORED_SIGNALS = SCORED_KEYS.length;
