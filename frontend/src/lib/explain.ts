import { SIGNALS } from './config';
import { severityLabel } from './scoring';
import { toDisplay, unitFor } from './units';
import type {
  Evidence, ExplainLevel, Explanation, ExplanationFinding, ExplanationStep, Scan, ScanAnomaly, Settings, Severity, Vehicle,
} from './types';

/**
 * PROTOTYPE explanation builder. It writes from structured facts using templates so the UI can be
 * built and reviewed now. The real backend replaces this with an LLM that receives the SAME facts
 * and must return the SAME shape; checkFaithfulness() is what keeps that LLM honest.
 */
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Plain number text (no thousands separators) so the faithfulness check can read it back exactly. */
function plain(v: number, key?: string): string {
  const abs = Math.abs(v);
  const digits = key === 'rpm' || abs >= 1000 ? 0 : key === 'battery_v' || key === 'afr' ? 2 : abs >= 100 ? 0 : 1;
  return v.toFixed(digits);
}

export function checkFaithfulness(parts: string[], evidence: Evidence[]): Explanation['faithfulness'] {
  const allowed = evidence.flatMap((e) => e.numbers);
  const found: number[] = [];
  for (const p of parts) for (const m of p.matchAll(/-?\d+(?:\.\d+)?/g)) found.push(parseFloat(m[0]));
  const unmatched = found.filter((x) => !allowed.some((a) => Math.abs(a - x) <= 0.051));
  return { checked: found.length, matched: found.length - unmatched.length, unmatched };
}

function collect(e: Omit<Explanation, 'faithfulness'>): string[] {
  return [
    e.headline, e.summary, e.meaning, ...e.findings.map((f) => f.text), ...e.steps.map((s) => s.text), ...e.questions, ...e.caveats,
  ];
}

const QUESTIONS: Record<string, string> = {
  battery_v: 'Can you test the battery and the alternator (charging system) output?',
  coolant_temp_c: 'Could you check the coolant level, the thermostat and the cooling fan?',
  rpm: 'Is there any reason the engine would be revving this high, such as a sticking throttle or gearbox issue?',
  intake_air_temp_c: 'Is the air intake picking up too much heat from the engine bay?',
};
const STEPS: Record<string, string> = {
  battery_v: 'Ask for a battery and charging-system test before the battery fails.',
  coolant_temp_c: 'Check the coolant level when the engine is cold and watch the temperature gauge.',
  rpm: 'Avoid holding the engine near its limit for long periods.',
  intake_air_temp_c: 'Park in the shade when you can and re-scan to see if it repeats.',
};

export function buildExplanation(
  scan: Scan, vehicle: Vehicle, settings: Settings, level: ExplainLevel, anomalies: ScanAnomaly[] = [],
): Explanation {
  const ev: Evidence[] = [];
  const add = (text: string, numbers: number[]): string => {
    const id = `E${ev.length + 1}`;
    ev.push({ id, text, numbers });
    return id;
  };
  const sev = scan.severity;
  add(`Overall health score ${scan.score} out of 100 (${severityLabel(sev)})`, [scan.score, 100]);
  const e2 = add(`${scan.scoredSignals} of ${scan.totalSignals} scored signals had data`, [scan.scoredSignals, scan.totalSignals]);
  if (vehicle.modelYear) add(`Vehicle: ${vehicle.name}, ${vehicle.modelYear}`, [vehicle.modelYear]);
  const scored = scan.signals.filter((s) => s.scored && s.available);
  const ids: Record<string, string> = {};
  for (const s of scored) {
    const u = unitFor(s.key, settings);
    const avgS = plain(toDisplay(s.key, s.avg, settings), s.key);
    ids[s.key] = add(
      `${s.label}: average ${avgS} ${u}; ${Math.round(s.pctNormal)}% normal, ${Math.round(s.pctWatch)}% watch, ${Math.round(s.pctAlert)}% alert`,
      [Number(avgS), Math.round(s.pctNormal), Math.round(s.pctWatch), Math.round(s.pctAlert), Math.round(s.pctWatch + s.pctAlert)],
    );
  }
  if (anomalies.length > 0) {
    ids.anom = add(`${anomalies.length} unusual reading${anomalies.length > 1 ? 's' : ''} compared with this vehicle's history`, [anomalies.length]);
  }
  if (scan.mixture) {
    ids.mix = add(
      `Air-fuel ratio median ${r1(scan.mixture.median)}:1 and ${Math.round(scan.mixture.pctRich)}% of running time richer than 12.5:1`,
      [r1(scan.mixture.median), Math.round(scan.mixture.pctRich), 12.5],
    );
  }

  const flagged = scored.filter((s) => s.severity !== 'normal');
  if (flagged.length > 0) add(`${flagged.length} signal${flagged.length > 1 ? 's' : ''} spent enough time outside the normal range to be flagged`, [flagged.length]);
  const findings: ExplanationFinding[] = flagged.map((s) => {
    const u = unitFor(s.key, settings);
    const abnormal = Math.round(s.pctWatch + s.pctAlert);
    const avgS = plain(toDisplay(s.key, s.avg, settings), s.key);
    const text = level === 'simple'
      ? `${s.label} was outside its comfortable range for about ${abnormal}% of the drive. ${SIGNALS[s.key].plain}`
      : `${s.label} averaged ${avgS} ${u}; ${Math.round(s.pctWatch)}% of samples fell in the Watch band and ${Math.round(s.pctAlert)}% in the Alert band.`;
    return { signal: s.label, text, severity: s.severity as Severity, evidence: [ids[s.key]] };
  });
  const okNames = scored.filter((s) => s.severity === 'normal').map((s) => s.label.toLowerCase());
  if (okNames.length > 0) {
    findings.push({
      signal: 'Everything else', severity: 'normal', evidence: [e2],
      text: `${okNames.join(', ')} stayed within the normal range.`,
    });
  }
  if (anomalies.length > 0) {
    findings.push({
      signal: 'Compared with history', severity: 'watch', evidence: [ids.anom],
      text: level === 'simple'
        ? 'Some readings look different from how this car usually behaves. See the Analytics tab for details.'
        : 'Robust z-score against this vehicle\'s own scans flagged readings outside its usual range. See the Analytics tab.',
    });
  }

  const name = vehicle.name;
  const headline =
    sev === 'none' ? 'There was not enough data to score this log'
    : sev === 'normal' ? `${name} looks healthy in this log`
    : sev === 'watch' ? `${name} has a few readings worth watching`
    : `${name} shows readings that need attention`;
  const summary = level === 'simple'
    ? `This log scored ${scan.score} out of 100. ${scan.scoredSignals} of ${scan.totalSignals} key readings could be checked. ${flagged.length === 0 ? 'None of them left the normal range for long.' : 'The ones below are the reason the score is not higher.'}`
    : `Weighted health score ${scan.score} out of 100 from ${scan.scoredSignals} of ${scan.totalSignals} scored signals. ${flagged.length === 0 ? 'No signal spent a meaningful share of time outside its normal band.' : `${flagged.length} signal${flagged.length > 1 ? 's' : ''} exceeded the Watch or Alert time thresholds.`}`;
  const meaning =
    sev === 'normal' ? 'Nothing in this log suggests a problem right now. Keep scanning regularly so changes show up early.'
    : sev === 'watch' ? 'This is not an emergency, but it is worth keeping an eye on. A repeat scan will show whether it is a one-off or a pattern.'
    : sev === 'alert' ? 'One or more readings stayed in a range that can lead to damage or breakdown if it continues. It is sensible to have the car checked soon.'
    : 'Upload a longer log or one that includes the main engine readings.';

  const steps: ExplanationStep[] = [];
  for (const s of flagged) if (STEPS[s.key]) steps.push({ text: STEPS[s.key], urgency: s.severity === 'alert' ? 'high' : 'medium' });
  steps.push(
    sev === 'alert' ? { text: 'Book a workshop visit soon and share this report.', urgency: 'high' }
    : sev === 'watch' ? { text: 'Scan again within a week and compare with this report.', urgency: 'medium' }
    : { text: 'Keep logging trips so changes are easy to spot.', urgency: 'low' },
  );
  const questions = flagged.map((s) => QUESTIONS[s.key]).filter((q): q is string => Boolean(q));
  const caveats = [
    "This report reflects only the uploaded log. It is not a mechanic's diagnosis.",
    'Ranges are generic defaults and are not tuned to this vehicle.',
  ];
  if (scan.scoredSignals < scan.totalSignals) {
    caveats.push(`Only ${scan.scoredSignals} of ${scan.totalSignals} scored signals had data, so the result is less certain.`);
  }
  if (scan.mixture) caveats.push('The air-fuel ratio is shown for information and is not part of the score; its scale and fuel type are unverified.');
  if (scan.simulated) caveats.push("This result comes from the prototype's simulator, not from real analysis of a file.");

  const base = { headline, summary, findings, meaning, steps, questions, caveats, evidence: ev, level, model: 'template-v1 (prototype)' };
  return { ...base, faithfulness: checkFaithfulness(collect(base), ev) };
}

export interface ChartFacts {
  vehicleName: string;
  signalLabel: string;
  unit: string;
  metricLabel: string;
  points: { date: string; value: number }[];
  baseline: { low: number; high: number } | null;
  anomalyCount: number;
  detectionEnabled: boolean;
  scansNeeded: number;
}

export function buildChartExplanation(f: ChartFacts, level: ExplainLevel): Explanation {
  const ev: Evidence[] = [];
  const add = (text: string, numbers: number[]): string => {
    const id = `E${ev.length + 1}`;
    ev.push({ id, text, numbers });
    return id;
  };
  const n = f.points.length;
  const values = f.points.map((p) => p.value);
  const first = values[0] ?? 0, last = values[n - 1] ?? 0;
  const change = r1(last - first);
  const lo = r1(Math.min(...values)), hi = r1(Math.max(...values));
  const eCount = add(`${n} scans plotted`, [n]);
  const eRange = add(`First ${r1(first)} ${f.unit}, latest ${r1(last)} ${f.unit}, change ${change}, range ${lo} to ${hi}`, [r1(first), r1(last), change, Math.abs(change), lo, hi]);
  const eAnom = add(`${f.anomalyCount} unusual scan${f.anomalyCount === 1 ? '' : 's'} flagged`, [f.anomalyCount]);
  const steady = n < 2 || Math.abs(last - first) < 0.03 * Math.max(Math.abs(first), 1e-6);
  const varied = n >= 2 && hi - lo > 0.05 * Math.max(Math.abs(first), 1e-6);
  const dir = steady ? (varied ? 'varied' : 'steady') : last > first ? 'rising' : 'falling';
  const sev: Severity = f.anomalyCount > 0 ? 'watch' : 'normal';
  const headline = n < 2 ? `Not enough scans yet to see a trend for ${f.signalLabel.toLowerCase()}`
    : dir === 'varied' ? `${f.signalLabel} (${f.metricLabel}) ends near where it started but moved in between, across ${n} scans`
    : `${f.signalLabel} (${f.metricLabel}) is ${dir} across ${n} scans`;
  const summary = n < 2
    ? 'Add at least two scans for this vehicle to see how the reading changes over time.'
    : dir === 'steady'
      ? `The ${f.metricLabel} stayed close to ${r1(first)} ${f.unit} across ${n} scans, between ${lo} and ${hi} ${f.unit}.`
      : dir === 'varied'
        ? `The ${f.metricLabel} started at ${r1(first)} and ended at ${r1(last)} ${f.unit}, but ranged from ${lo} to ${hi} ${f.unit} in between.`
      : `The ${f.metricLabel} moved from ${r1(first)} to ${r1(last)} ${f.unit} across ${n} scans, a change of ${change} ${f.unit}.`;
  const findings: ExplanationFinding[] = [];
  if (f.detectionEnabled) {
    findings.push({
      signal: 'Unusual scans', severity: sev, evidence: [eAnom],
      text: f.anomalyCount === 0 ? 'No scan stands out from this vehicle\'s usual pattern.'
        : `${f.anomalyCount} scan${f.anomalyCount === 1 ? ' is' : 's are'} outside this vehicle's usual range and marked on the chart.`,
    });
  } else {
    findings.push({
      signal: 'Unusual scans', severity: 'none', evidence: [eCount],
      text: `Unusual-scan detection needs ${f.scansNeeded} more scan${f.scansNeeded === 1 ? '' : 's'} before it can compare this vehicle with its own history.`,
    });
  }
  findings.push({ signal: 'Range', severity: 'none', evidence: [eRange], text: `Values ranged from ${lo} to ${hi} ${f.unit}.` });
  const meaning = level === 'simple'
    ? 'A single reading can be a one-off. A steady move in one direction across several scans is more meaningful.'
    : 'Trend direction is judged from first versus latest value; the shaded band is this vehicle\'s own usual range (median plus or minus two robust deviations).';
  const caveats = ['Trends use only the scans uploaded for this vehicle.', "This is not a mechanic's diagnosis."];
  const base = {
    headline, summary, findings, meaning, steps: [] as ExplanationStep[], questions: [] as string[], caveats,
    evidence: ev, level, model: 'template-v1 (prototype)',
  };
  return { ...base, faithfulness: checkFaithfulness(collect(base), ev) };
}
