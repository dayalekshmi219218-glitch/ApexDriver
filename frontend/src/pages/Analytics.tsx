import clsx from 'clsx';
import { LineChart as LineIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExplainCard } from '../components/ExplainCard';
import { MixtureHeatmap } from '../components/Heatmap';
import { SeriesChart } from '../components/SeriesChart';
import { TrendChart, type TrendPoint } from '../components/TrendChart';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Pill } from '../components/ui/Pill';
import { Segmented } from '../components/ui/Segmented';
import { describeAnomaly, detectAnomalies, median, robustScale, scanFeatures } from '../lib/anomaly';
import { SCORED_KEYS, SIGNALS } from '../lib/config';
import type { ChartFacts } from '../lib/explain';
import { fmtDateTime, fmtShortDate, toDisplay, unitFor } from '../lib/units';
import type { FeatureKind, SignalKey } from '../lib/types';
import { api } from '../services/api';
import { useStore, useVehicleScans } from '../state/store';

const METRICS: { value: FeatureKind; label: string; chart: string }[] = [
  { value: 'median', label: 'Typical level', chart: 'typical level' },
  { value: 'p95', label: 'High end', chart: 'high end' },
  { value: 'pctAbnormal', label: 'Time outside range', chart: 'share of time outside range' },
];

export default function Analytics() {
  const { vehicles, settings, setSettings } = useStore();
  const [vehicleId, setVehicleId] = useState<string>('');
  const [signal, setSignal] = useState<SignalKey>('battery_v');
  const [metric, setMetric] = useState<FeatureKind>('median');
  const [scanId, setScanId] = useState<string>('');
  const [seriesSignal, setSeriesSignal] = useState<SignalKey>('coolant_temp_c');

  useEffect(() => {
    if (!vehicleId && vehicles[0]) setVehicleId(vehicles[0].id);
    if (vehicleId && !vehicles.some((v) => v.id === vehicleId)) setVehicleId(vehicles[0]?.id ?? '');
  }, [vehicles, vehicleId]);

  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const scans = useVehicleScans(vehicleId);
  const result = useMemo(() => detectAnomalies(scans), [scans]);
  // a scan flagged for this signal on any measure is marked on every measure's chart
  const flagged = useMemo(() => new Set(result.anomalies.filter((a) => a.signal === signal).map((a) => a.scanId)), [result, signal]);

  useEffect(() => { setScanId(scans.length ? scans[scans.length - 1].id : ''); }, [vehicleId, scans.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const isPct = metric === 'pctAbnormal';
  const conv = useCallback((v: number) => (isPct ? v : toDisplay(signal, v, settings)), [isPct, signal, settings]);
  const unit = isPct ? '% of time' : unitFor(signal, settings);

  const points: TrendPoint[] = useMemo(() => scans.map((s) => {
    const f = scanFeatures(s)[`${signal}|${metric}`];
    return { scanId: s.id, label: fmtShortDate(s.startedAt), value: f === undefined ? NaN : conv(f), anomaly: flagged.has(s.id) };
  }).filter((p) => Number.isFinite(p.value)), [scans, signal, metric, conv, flagged]);

  const baseline = useMemo(() => {
    if (!result.enabled || points.length === 0) return null;
    const vals = points.map((p) => p.value);
    const med = median(vals);
    const sc = Math.max(robustScale(vals, med), 1e-6);
    return { low: isPct ? Math.max(0, med - 2 * sc) : med - 2 * sc, high: med + 2 * sc };
  }, [result.enabled, points, isPct]);

  const metricMeta = METRICS.find((m) => m.value === metric)!;
  const facts: ChartFacts = useMemo(() => ({
    vehicleName: vehicle?.name ?? '', signalLabel: SIGNALS[signal].label, unit, metricLabel: metricMeta.chart,
    points: points.map((p) => ({ date: p.label, value: p.value })), baseline,
    anomalyCount: points.filter((p) => p.anomaly).length, detectionEnabled: result.enabled, scansNeeded: result.scansNeeded,
  }), [vehicle, signal, unit, metricMeta, points, baseline, result]);
  const fetcher = useCallback((lv: 'simple' | 'technical') => api.explainChart(facts, lv), [facts]);

  if (vehicles.length === 0) {
    return <EmptyState icon={<LineIcon size={26} />} title="Nothing to analyse yet" text="Add a vehicle and upload at least two scans to see trends."
      action={<Link to="/vehicles"><Button>Go to vehicles</Button></Link>} />;
  }

  const selScan = scans.find((s) => s.id === scanId);
  const seriesValues = selScan?.series[seriesSignal];
  const seriesKeys = (Object.keys(SIGNALS) as SignalKey[]).filter((k) => selScan?.series[k]);
  const hasMixture = scans.some((s) => s.series.afr);

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="mt-1 text-muted">How a vehicle changes across scans, and which scans look unusual for it.</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted">Vehicle</span>
          <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}
            className="h-11 rounded-xl border border-border bg-surface2 px-3 text-sm font-medium outline-none focus:border-primary">
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}{v.modelYear ? ` (${v.modelYear})` : ''}</option>)}
          </select>
        </label>
      </div>

      {scans.length < 2 ? (
        <EmptyState icon={<LineIcon size={26} />} title="Needs at least two scans" text="Upload another trip log for this vehicle to see how its readings change."
          action={vehicle && <Link to={`/vehicles/${vehicle.id}`}><Button>Upload a scan</Button></Link>} />
      ) : (
        <>
          <section className="card p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-lg font-semibold">Trend across {scans.length} scans</h2>
              <Segmented label="Measure" value={metric} onChange={setMetric} options={METRICS.map((m) => ({ value: m.value, label: m.label }))} />
            </div>
            <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Signal">
              {SCORED_KEYS.map((k) => (
                <button key={k} role="tab" aria-selected={signal === k} onClick={() => setSignal(k)}
                  className={clsx('rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
                    signal === k ? 'border-primary bg-primary-soft text-on-primary-soft' : 'border-border text-muted hover:text-ink')}>
                  {SIGNALS[k].label}
                </button>
              ))}
            </div>
            <div className="mt-4">
              {points.length < 2 ? <p className="py-16 text-center text-sm text-muted">Not enough data for this signal.</p>
                : <TrendChart points={points} baseline={baseline} unit={unit} selectedId={scanId} onSelect={setScanId} />}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-primary" /> a scan</span>
              <span className="inline-flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-sev-alert" /> unusual for this vehicle</span>
              {baseline && <span className="inline-flex items-center gap-1.5"><i className="h-2 w-4 rounded border border-dashed border-sev-normal bg-sev-normal/15" /> this vehicle's usual range</span>}
            </div>
          </section>

          <ExplainCard title="Explain this chart" fetcher={fetcher} level={settings.explainLevel} onLevel={(l) => setSettings({ explainLevel: l })}
            resetKey={`${vehicleId}-${signal}-${metric}-${scans.length}-${settings.tempUnit}`} />

          <section className="card p-5 sm:p-6">
            <h2 className="text-lg font-semibold">Unusual scans</h2>
            {!result.enabled ? (
              <div className="mt-3 rounded-xl bg-surface2 p-4 text-sm text-muted">
                Comparing a scan with the vehicle's own history needs at least 8 scans. This vehicle has {scans.length}, so <b className="text-ink">{result.scansNeeded} more</b> {result.scansNeeded === 1 ? 'scan is' : 'scans are'} needed. Charts and reports still work.
              </div>
            ) : result.anomalies.length === 0 ? (
              <p className="mt-3 text-sm text-muted">No scan stands out from this vehicle's usual pattern.</p>
            ) : (
              <ul className="mt-4 divide-y divide-border">
                {result.anomalies.map((a, i) => {
                  const s = scans.find((x) => x.id === a.scanId);
                  return (
                    <li key={i} className="flex flex-wrap items-start justify-between gap-3 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {s ? fmtDateTime(s.startedAt) : a.scanId}<Pill severity="watch" label="Unusual" />
                        </div>
                        <p className="mt-1 text-sm text-muted">{describeAnomaly(a, settings)}</p>
                      </div>
                      <Link to={`/scans/${a.scanId}`}><Button variant="outline" size="sm">Open report</Button></Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-4 text-xs text-subtle">Method: each scan is compared with the vehicle's other scans using a robust z-score; only changes in the unhealthy direction are flagged.</p>
          </section>

          {selScan && seriesValues && (
            <section className="card p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold">Inside one scan</h2>
                  <p className="text-sm text-muted">Shaded bands show the normal, watch and alert zones. Red dots are sudden jumps within the trip.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select value={scanId} onChange={(e) => setScanId(e.target.value)} aria-label="Scan"
                    className="h-10 rounded-xl border border-border bg-surface2 px-3 text-sm outline-none focus:border-primary">
                    {[...scans].reverse().map((s) => <option key={s.id} value={s.id}>{fmtDateTime(s.startedAt)}</option>)}
                  </select>
                  <select value={seriesSignal} onChange={(e) => setSeriesSignal(e.target.value as SignalKey)} aria-label="Signal"
                    className="h-10 rounded-xl border border-border bg-surface2 px-3 text-sm outline-none focus:border-primary">
                    {seriesKeys.map((k) => <option key={k} value={k}>{SIGNALS[k].label}</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-4">
                <SeriesChart signal={seriesSignal} values={seriesValues} durationMin={selScan.durationMin}
                  unit={unitFor(seriesSignal, settings)} convert={(v) => toDisplay(seriesSignal, v, settings)} />
              </div>
            </section>
          )}

          {hasMixture && (
            <section className="card p-5 sm:p-6">
              <h2 className="text-lg font-semibold">Fuel mixture by engine speed and load <span className="ml-2 align-middle text-xs font-medium text-muted">tuning indicator, not scored</span></h2>
              <p className="mb-4 mt-1 text-sm text-muted">Average air-fuel ratio across all scans. Cells with too little data stay empty.</p>
              <MixtureHeatmap scans={scans} />
            </section>
          )}
        </>
      )}
    </div>
  );
}
