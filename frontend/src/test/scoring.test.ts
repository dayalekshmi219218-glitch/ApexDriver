import { describe, expect, it } from 'vitest';
import { SIGNALS, SIGNAL_ORDER } from '../lib/config';
import { bandOfScore, scoreSample, summarizeScan } from '../lib/scoring';

const cool = SIGNALS.coolant_temp_c.cfg;
const batt = SIGNALS.battery_v.cfg;
const rpm = SIGNALS.rpm.cfg;

describe('scoreSample (port of Android ScoreCalculator)', () => {
  it('scores normal values 100, including cold coolant (warm-up is handled by the state mask)', () => {
    expect(scoreSample(90, cool)).toBe(100);
    expect(scoreSample(60, cool)).toBe(100);
  });
  it('interpolates the moderate band 100 -> 60', () => {
    expect(scoreSample(112.5, cool)).toBeCloseTo(80, 5);
    expect(scoreSample(5000, rpm)).toBeCloseTo(80, 5);
  });
  it('drops into the critical band below 60 with the Android heuristic', () => {
    expect(scoreSample(130, cool)).toBeCloseTo(60 - (10 / 120) * 50, 4);
    expect(scoreSample(6500, rpm)).toBeCloseTo(60 - (500 / 6000) * 50, 4);
  });
  it('battery both directions; low band is interpolated (Android scored a flat 60 there)', () => {
    expect(scoreSample(13, batt)).toBe(100);
    expect(scoreSample(11.75, batt)).toBeCloseTo(80, 5);
    expect(scoreSample(11.0, batt)).toBeCloseTo(60 - (0.5 / 11.5) * 50, 4);
    expect(scoreSample(15.15, batt)).toBeCloseTo(80, 5);
    expect(scoreSample(16, batt)).toBeCloseTo(60 - (0.5 / 15.5) * 50, 4);
  });
  it('never returns below the floor of 10 or above 100', () => {
    for (const v of [-50, 0, 11, 12, 50, 150, 1e6]) {
      for (const c of [cool, batt, rpm]) {
        const s = scoreSample(v, c);
        expect(s).toBeGreaterThanOrEqual(10);
        expect(s).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe('zones in config agree with the scorer', () => {
  it('the middle of every zone lands in the same band the zone claims', () => {
    for (const key of SIGNAL_ORDER) {
      const c = SIGNALS[key];
      if (!c.scored) continue;
      for (const z of c.zones) {
        const mid = (z.from + z.to) / 2;
        expect(bandOfScore(scoreSample(mid, c.cfg)), `${key} zone ${z.from}-${z.to}`).toBe(z.sev);
      }
    }
  });
});

describe('summarizeScan', () => {
  it('does not score missing signals as healthy', () => {
    const s = summarizeScan({});
    expect(s.scoredSignals).toBe(0);
    expect(s.score).toBe(0);
    expect(s.severity).toBe('none');
  });
  it('ignores warm-up samples for coolant', () => {
    const n = 10;
    const series = {
      rpm: Array(n).fill(900), coolant_temp_c: Array(n).fill(50), battery_v: Array(n).fill(13.5),
    };
    const s = summarizeScan(series);
    const coolant = s.signals.find((x) => x.key === 'coolant_temp_c')!;
    expect(coolant.available).toBe(false);
    expect(s.scoredSignals).toBe(2); // battery and rpm; coolant has no warmed-up samples
    expect(s.states.warmup).toBe(100);
  });
  it('blends the weighted mean with the weakest signal', () => {
    const n = 20;
    const series = {
      rpm: Array(n).fill(1500), coolant_temp_c: Array(n).fill(90), battery_v: Array(n).fill(11.0),
    };
    const s = summarizeScan(series);
    const b = s.signals.find((x) => x.key === 'battery_v')!;
    expect(b.severity).toBe('alert');
    const mean = (6 * 100 + 3.5 * (b.score as number) + 5 * 100) / (6 + 3.5 + 5);
    const expected = Math.round(0.6 * mean + 0.4 * (b.score as number));
    expect(s.score).toBe(expected);
  });
});
