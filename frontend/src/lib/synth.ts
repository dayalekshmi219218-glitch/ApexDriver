import { SERIES_POINTS, type Scan, type SignalKey, type Vehicle } from './types';
import { gauss, hashString, mulberry32 } from './rng';
import { summarizeScan } from './scoring';

/** Everything here is SYNTHETIC. It is parameterised, not copied from any real dataset. */
export interface Profile {
  coolStart: [number, number];
  coolTarget: number;
  coolTau: number;
  batt: number;
  battNoise: number;
  airBase: number;
  hasAfr: boolean;
  afrBase: number;
}

export interface Tweaks {
  battDelta?: number;
  coolDelta?: number;
  battDips?: number;
  revSpikes?: number;
}

type Series = Partial<Record<SignalKey, number[]>>;
const r2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function generateSeries(p: Profile, rng: () => number, durationMin: number, tw: Tweaks = {}): Series {
  const n = SERIES_POINTS;
  const modes: number[] = [];
  let mode = 0;
  for (let i = 0; i < n; i++) {
    if (i === 0 || rng() < 0.2) {
      const u = rng();
      mode = u < 0.25 ? 0 : u < 0.8 ? 1 : 2;
    }
    modes.push(mode);
  }
  const rpm: number[] = [], thr: number[] = [], load: number[] = [], ign: number[] = [];
  const cool: number[] = [], batt: number[] = [], air: number[] = [], afr: number[] = [];
  const start = p.coolStart[0] + rng() * (p.coolStart[1] - p.coolStart[0]);
  const target = p.coolTarget + (tw.coolDelta ?? 0);
  const dips = new Set<number>();
  for (let d = 0; d < (tw.battDips ?? 0); d++) dips.add(10 + Math.floor(rng() * (n - 12)));
  const spikes = new Set<number>();
  for (let s = 0; s < (tw.revSpikes ?? 0); s++) spikes.add(10 + Math.floor(rng() * (n - 12)));
  let prevRpm = 780;
  for (let i = 0; i < n; i++) {
    const m = modes[i];
    const minute = (i * durationMin) / n;
    const rpmTarget = m === 0 ? 780 + gauss(rng) * 30 : m === 1 ? 1500 + rng() * 1100 : 2600 + rng() * 1200;
    let rv = 0.45 * prevRpm + 0.55 * rpmTarget;
    let tv = m === 0 ? 2.8 + gauss(rng) * 0.3 : m === 1 ? 8 + rng() * 10 : 22 + rng() * 25;
    let lv = m === 0 ? 33 + gauss(rng) * 2 : m === 1 ? 42 + rng() * 20 : 72 + rng() * 22;
    if (spikes.has(i)) { rv = 4600 + rng() * 2400; tv = 60 + rng() * 20; lv = 92 + rng() * 6; }
    prevRpm = rv;
    rpm.push(r2(rv)); thr.push(r2(clamp(tv, 0, 100))); load.push(r2(clamp(lv, 20, 100)));
    ign.push(r2(m === 0 ? 14 + gauss(rng) : m === 1 ? 23 + gauss(rng) * 2 : 28 + gauss(rng) * 2));
    cool.push(r2(target - (target - start) * Math.exp(-minute / p.coolTau) + gauss(rng) * 0.4));
    let bv = p.batt + (tw.battDelta ?? 0) + gauss(rng) * p.battNoise - (m === 0 ? 0.08 : 0);
    if (dips.has(i)) bv -= 0.5 + rng() * 0.6;
    batt.push(r2(bv));
    air.push(r2(p.airBase + minute * 0.06 + gauss(rng) * 0.7 - (m === 2 ? 1.5 : 0)));
    afr.push(r2(p.afrBase + (m === 0 ? 0.1 : m === 1 ? 0.2 : -0.5) + gauss(rng) * 0.3));
  }
  const out: Series = {
    rpm, throttle_pct: thr, load_kpa: load, ignition_deg: ign, coolant_temp_c: cool, battery_v: batt, intake_air_temp_c: air,
  };
  if (p.hasAfr) out.afr = afr;
  return out;
}

export interface ScanInput {
  id: string;
  vehicleId: string;
  startedAt: string;
  durationMin: number;
  source: string;
  fileName: string;
  simulated: boolean;
  series: Series;
}

export function buildScan(input: ScanInput): Scan {
  const sum = summarizeScan(input.series);
  return {
    id: input.id, vehicleId: input.vehicleId, startedAt: input.startedAt, durationMin: input.durationMin,
    source: input.source, fileName: input.fileName, simulated: input.simulated, score: sum.score, severity: sum.severity,
    scoredSignals: sum.scoredSignals, totalSignals: sum.totalSignals, states: sum.states, signals: sum.signals,
    series: input.series, mixture: sum.mixture,
  };
}

const DAY = 86400000;

interface DemoSpec {
  vehicle: Vehicle;
  profile: Profile;
  count: number;
  endDaysAgo: number;
  spacingDays: number;
  tweaks: (i: number) => Tweaks;
  source: string;
  seed: number;
}

export function seedDemo(now = Date.now()): { vehicles: Vehicle[]; scans: Scan[] } {
  const iso = (t: number) => new Date(t).toISOString();
  const mk = (id: string, name: string, year: number, ago: number): Vehicle => ({
    id, name, modelYear: year, createdAt: iso(now - ago * DAY), synthetic: true,
  });
  const specs: DemoSpec[] = [
    {
      vehicle: mk('veh-demo-1', 'Demo Hatchback', 2018, 70),
      profile: { coolStart: [38, 52], coolTarget: 87, coolTau: 6.5, batt: 12.9, battNoise: 0.1, airBase: 53, hasAfr: true, afrBase: 10.0 },
      count: 12, endDaysAgo: 2, spacingDays: 5, source: 'Haltech ECU datalog (synthetic)', seed: 11,
      tweaks: (i) => (i === 5 ? { battDelta: -1.6, battDips: 3 } : i === 8 ? { revSpikes: 12 } : i === 10 ? { coolDelta: 32 } : {}),
    },
    {
      vehicle: mk('veh-demo-2', 'Family SUV', 2021, 60),
      profile: { coolStart: [45, 70], coolTarget: 90, coolTau: 7, batt: 13.8, battNoise: 0.14, airBase: 48, hasAfr: false, afrBase: 14.7 },
      count: 10, endDaysAgo: 1, spacingDays: 4, source: 'OBD logger CSV (synthetic)', seed: 22,
      tweaks: (i) => ({ battDelta: i >= 3 ? -0.4 * (i - 2) : 0, battDips: i >= 6 ? 2 : 0 }),
    },
    {
      vehicle: mk('veh-demo-3', 'City Hatchback', 2015, 35),
      profile: { coolStart: [40, 60], coolTarget: 94, coolTau: 7.5, batt: 13.4, battNoise: 0.12, airBase: 51, hasAfr: false, afrBase: 14.7 },
      count: 5, endDaysAgo: 3, spacingDays: 6, source: 'OBD logger CSV (synthetic)', seed: 33,
      tweaks: (i) => ({ coolDelta: [0, 3, 10, 20, 32][i] ?? 0 }),
    },
  ];
  const vehicles: Vehicle[] = [];
  const scans: Scan[] = [];
  for (const spec of specs) {
    vehicles.push(spec.vehicle);
    for (let i = 0; i < spec.count; i++) {
      const rng = mulberry32(spec.seed * 1000 + i);
      const daysAgo = spec.endDaysAgo + (spec.count - 1 - i) * spec.spacingDays;
      const startedAt = iso(now - daysAgo * DAY - Math.floor(rng() * 6) * 3600000);
      const durationMin = Math.round(26 + rng() * 26);
      const series = generateSeries(spec.profile, rng, durationMin, spec.tweaks(i));
      scans.push(buildScan({
        id: `scan-${spec.vehicle.id}-${i}`, vehicleId: spec.vehicle.id, startedAt, durationMin,
        source: spec.source, fileName: `trip-${String(i + 1).padStart(2, '0')}.csv`, simulated: true, series,
      }));
    }
  }
  return { vehicles, scans };
}

/** Prototype stand-in for the backend: turns an uploaded file into a plausible synthetic scan. */
export function simulateUpload(
  vehicle: Vehicle, fileName: string, sizeBytes: number, source: string, now = Date.now(),
): Scan {
  const rng = mulberry32(hashString(`${fileName}:${sizeBytes}`));
  const vrng = mulberry32(hashString(vehicle.id));
  const profile: Profile = {
    coolStart: [38 + vrng() * 6, 52 + vrng() * 10], coolTarget: 84 + vrng() * 8, coolTau: 6 + vrng() * 2,
    batt: 12.8 + vrng() * 1.1, battNoise: 0.1 + vrng() * 0.06, airBase: 38 + vrng() * 10,
    hasAfr: false, afrBase: 14.7,
  };
  const durationMin = Math.round(25 + rng() * 28);
  const series = generateSeries(profile, rng, durationMin);
  return buildScan({
    id: `scan-${Math.floor(now).toString(36)}-${Math.floor(rng() * 1e6).toString(36)}`, vehicleId: vehicle.id,
    startedAt: new Date(now).toISOString(), durationMin, source, fileName, simulated: true, series,
  });
}
