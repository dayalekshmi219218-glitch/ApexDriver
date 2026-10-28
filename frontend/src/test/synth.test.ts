import { describe, expect, it } from 'vitest';
import { detectAnomalies } from '../lib/anomaly';
import { buildExplanation } from '../lib/explain';
import { seedDemo } from '../lib/synth';
import { SERIES_POINTS, type Settings } from '../lib/types';

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);
const settings: Settings = { tempUnit: 'C', speedUnit: 'kmh', explainLevel: 'simple', theme: 'dark' };
const demo = seedDemo(NOW);
const byVeh = (id: string) => demo.scans.filter((s) => s.vehicleId === id).sort((a, b) => a.startedAt.localeCompare(b.startedAt));

describe('synthetic demo data', () => {
  it('is reproducible', () => {
    const again = seedDemo(NOW);
    expect(again.scans.map((s) => s.score)).toEqual(demo.scans.map((s) => s.score));
  });
  it('has the planned shape', () => {
    expect(demo.vehicles).toHaveLength(3);
    expect(byVeh('veh-demo-1')).toHaveLength(12);
    expect(byVeh('veh-demo-2')).toHaveLength(10);
    expect(byVeh('veh-demo-3')).toHaveLength(5);
    for (const s of demo.scans) for (const arr of Object.values(s.series)) expect(arr).toHaveLength(SERIES_POINTS);
  });
  it('prints the score history for inspection', () => {
    for (const id of ['veh-demo-1', 'veh-demo-2', 'veh-demo-3']) console.log(id, byVeh(id).map((x) => `${x.score}${x.severity[0]}`).join(' '));
  });
  it('ranks the vehicles the way the story needs (healthy > battery sag > overheating)', () => {
    const last = (id: string) => byVeh(id).at(-1)!.score;
    console.log('latest scores', { v1: last('veh-demo-1'), v2: last('veh-demo-2'), v3: last('veh-demo-3') });
    expect(last('veh-demo-1')).toBeGreaterThan(last('veh-demo-2'));
    expect(last('veh-demo-3')).toBeLessThan(80);
    expect(last('veh-demo-2')).toBeLessThan(80);
    expect(last('veh-demo-1')).toBeGreaterThanOrEqual(80);
  });
  it('only the ECU-style demo car has a mixture summary', () => {
    expect(byVeh('veh-demo-1')[0].mixture).not.toBeNull();
    expect(byVeh('veh-demo-2')[0].mixture).toBeNull();
  });
});

describe('anomaly detection on demo data', () => {
  it('stays off with too little history', () => {
    const r = detectAnomalies(byVeh('veh-demo-3'));
    expect(r.enabled).toBe(false);
    expect(r.scansNeeded).toBe(3);
  });
  it('finds the injected faults in the ECU-style car and not much else', () => {
    const scans = byVeh('veh-demo-1');
    const r = detectAnomalies(scans);
    console.log('demo-1 anomalies', r.anomalies.map((a) => `${a.scanId.slice(-1)}:${a.signal}.${a.feature} z=${a.z.toFixed(1)}`));
    expect(r.enabled).toBe(true);
    const ids = new Set(r.anomalies.map((a) => a.scanId));
    expect(ids.has(scans[5].id)).toBe(true); // battery sag
    expect(ids.has(scans[8].id)).toBe(true); // rev spikes
    expect(ids.has(scans[10].id)).toBe(true); // coolant running hot
    expect(r.anomalies.length).toBeLessThanOrEqual(8);
  });
});

describe('anomaly wording', () => {
  it('never shows a negative percentage range and formats percentages without a space', async () => {
    const { describeAnomaly } = await import('../lib/anomaly');
    const r = detectAnomalies(byVeh('veh-demo-1'));
    const pctOnes = r.anomalies.filter((a) => a.feature === 'pctAbnormal');
    expect(pctOnes.length).toBeGreaterThan(0);
    for (const a of pctOnes) {
      expect(a.baselineLow).toBeGreaterThanOrEqual(0);
      const text = describeAnomaly(a, { tempUnit: 'C' });
      expect(text).not.toMatch(/-\d/);
      expect(text).toMatch(/\d%/);
    }
  });
});

describe('chart explanations', () => {
  it('calls a trend that dips and recovers "moved in between", and stays faithful', async () => {
    const { buildChartExplanation } = await import('../lib/explain');
    const mk = (values: number[]) => buildChartExplanation({
      vehicleName: 'x', signalLabel: 'Battery voltage', unit: 'V', metricLabel: 'typical level',
      points: values.map((v, i) => ({ date: String(i), value: v })), baseline: null, anomalyCount: 1, detectionEnabled: true, scansNeeded: 0,
    }, 'simple');
    const dip = mk([12.9, 12.9, 11.3, 12.9, 12.9]);
    expect(dip.headline).toMatch(/moved in between/);
    expect(dip.faithfulness.unmatched).toEqual([]);
    expect(mk([12.9, 12.88, 12.91, 12.9]).headline).toMatch(/steady/);
    expect(mk([13.8, 13.2, 12.5]).headline).toMatch(/falling/);
  });
});

describe('explanations are faithful to their facts', () => {
  it('every number in every demo explanation matches the evidence, in both levels', () => {
    for (const scan of demo.scans) {
      const vehicle = demo.vehicles.find((v) => v.id === scan.vehicleId)!;
      for (const level of ['simple', 'technical'] as const) {
        const e = buildExplanation(scan, vehicle, settings, level, []);
        expect(e.faithfulness.unmatched, `${scan.id} ${level}`).toEqual([]);
        const ids = new Set(e.evidence.map((x) => x.id));
        for (const f of e.findings) for (const id of f.evidence) expect(ids.has(id)).toBe(true);
      }
    }
  });
  it('the checker catches an invented number', async () => {
    const { checkFaithfulness } = await import('../lib/explain');
    const r = checkFaithfulness(['Battery averaged 9.9 V'], [{ id: 'E1', text: 'x', numbers: [13.1] }]);
    expect(r.unmatched).toEqual([9.9]);
  });
});
