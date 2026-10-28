import { AlertTriangle, ArrowDown, ArrowRight, ArrowUp, Car, FileText, Gauge as GaugeIcon, Plus, Wand2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ExplainCard } from '../components/ExplainCard';
import { Gauge } from '../components/Gauge';
import { RankedBars, type RankRow } from '../components/RankedBars';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Pill } from '../components/ui/Pill';
import { VehicleDialog } from '../components/VehicleDialog';
import { SIGNALS } from '../lib/config';
import { fmtDate, fmtNum, timeAgo, toDisplay, unitFor } from '../lib/units';
import type { Scan } from '../lib/types';
import { api } from '../services/api';
import { useStore } from '../state/store';

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-muted">{icon}<span className="label">{label}</span></div>
      <div className="mt-2 font-display text-3xl font-bold tabular-nums">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { user, vehicles, scans, settings, setSettings, addVehicle, loadDemo, notify } = useStore();
  const nav = useNavigate();
  const [dialog, setDialog] = useState(false);

  const latestByVehicle = useMemo(() => {
    const m = new Map<string, Scan>();
    for (const s of [...scans].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) m.set(s.vehicleId, s);
    return m;
  }, [scans]);
  const rows: RankRow[] = vehicles.map((v) => ({ vehicle: v, scan: latestByVehicle.get(v.id) ?? null }));
  const scored = rows.filter((r) => r.scan);
  const avg = scored.length ? Math.round(scored.reduce((a, r) => a + (r.scan?.score ?? 0), 0) / scored.length) : null;
  const attention = scored.filter((r) => r.scan && r.scan.severity !== 'normal').length;
  const last = useMemo(() => [...scans].sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ?? null, [scans]);
  const lastVehicle = vehicles.find((v) => v.id === last?.vehicleId);
  const previous = useMemo(() => {
    if (!last) return null;
    const same = scans.filter((s) => s.vehicleId === last.vehicleId && s.startedAt < last.startedAt).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return same[0] ?? null;
  }, [scans, last]);

  const fetcher = useCallback((lv: 'simple' | 'technical') => api.explainScan(last!.id, lv, settings), [last, settings]);

  if (vehicles.length === 0) {
    return (
      <div className="animate-fade-up">
        <h1 className="text-3xl font-bold">Welcome{user ? `, ${user.name.split(' ')[0]}` : ''}</h1>
        <p className="mt-1 text-muted">Add your first vehicle to start tracking its health.</p>
        <div className="mt-8">
          <EmptyState
            icon={<Car size={26} />} title="No vehicles yet"
            text="A vehicle is a car you want to track. After adding one you can upload trip logs and get a health report for each."
            action={<>
              <Button icon={<Plus size={16} />} onClick={() => setDialog(true)}>Add a vehicle</Button>
              <Button variant="outline" icon={<Wand2 size={16} />} onClick={async () => { await loadDemo(); notify('Demo vehicles added'); }}>Load demo data</Button>
            </>}
          />
        </div>
        {dialog && <VehicleDialog onClose={() => setDialog(false)} onSave={async (n, y) => { const v = await addVehicle(n, y); nav(`/vehicles/${v.id}`); }} />}
      </div>
    );
  }

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="mt-1 text-muted">How your vehicles are doing, based on their latest scans.</p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => setDialog(true)}>Add vehicle</Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={<Car size={16} />} label="Vehicles" value={String(vehicles.length)} />
        <Stat icon={<FileText size={16} />} label="Scans" value={String(scans.length)} />
        <Stat icon={<GaugeIcon size={16} />} label="Average score" value={avg === null ? '-' : String(avg)} hint="latest scan of each vehicle" />
        <Stat icon={<AlertTriangle size={16} />} label="Need attention" value={String(attention)} hint={attention ? 'Watch or Alert' : 'all vehicles look fine'} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <section className="card p-5 sm:p-6">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">Vehicle ranking</h2>
            <span className="text-xs text-muted">healthiest to least healthy</span>
          </div>
          <RankedBars rows={rows} />
          <p className="mt-4 text-xs text-subtle">Scores from different vehicles are indicative only: each depends on how many signals the log contained.</p>
        </section>

        {last && lastVehicle && (
          <section className="card flex flex-col items-center p-5 text-center sm:p-6">
            <div className="label">Last scanned</div>
            <h2 className="mt-1 text-xl font-semibold">{lastVehicle.name}</h2>
            <p className="text-sm text-muted">{fmtDate(last.startedAt)} - {timeAgo(last.startedAt)}</p>
            <div className="my-4"><Gauge value={last.score} severity={last.severity} size={190} /></div>
            <p className="text-sm text-muted">Based on {last.scoredSignals} of {last.totalSignals} signals</p>
            <Link to={`/scans/${last.id}`} className="mt-4 w-full">
              <Button variant="soft" className="w-full" icon={<ArrowRight size={16} />}>Open report</Button>
            </Link>
          </section>
        )}
      </div>

      {last && lastVehicle && (
        <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <ExplainCard
            title={`Latest insight - ${lastVehicle.name}`} fetcher={fetcher} level={settings.explainLevel}
            onLevel={(l) => setSettings({ explainLevel: l })} auto resetKey={last.id}
          />
          <section className="card p-5 sm:p-6">
            <h2 className="text-lg font-semibold">What changed since the last scan</h2>
            {!previous ? (
              <p className="mt-3 text-sm text-muted">Upload another scan for this vehicle to see what moved.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                <li className="flex items-center justify-between text-sm">
                  <span className="font-medium">Health score</span>
                  <span className="flex items-center gap-2 tabular-nums">{previous.score} <ArrowRight size={14} className="text-subtle" /> <b>{last.score}</b>
                    <Pill severity={last.severity} /></span>
                </li>
                {last.signals.filter((s) => s.scored && s.available).map((s) => {
                  const p = previous.signals.find((x) => x.key === s.key);
                  if (!p || !p.available) return null;
                  const a = toDisplay(s.key, p.avg, settings), b = toDisplay(s.key, s.avg, settings);
                  const d = b - a;
                  const flat = Math.abs(d) < Math.max(0.005 * Math.abs(a), 0.05);
                  return (
                    <li key={s.key} className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted">{SIGNALS[s.key].label}</span>
                      <span className="flex items-center gap-1.5 tabular-nums">
                        {flat ? <span className="text-subtle">no change</span> : (<>
                          {d > 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                          <b>{fmtNum(Math.abs(d), s.key)}</b> {unitFor(s.key, settings)}
                        </>)}
                        {s.severity !== p.severity && <Pill severity={s.severity} />}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
      {dialog && <VehicleDialog onClose={() => setDialog(false)} onSave={async (n, y) => { const v = await addVehicle(n, y); nav(`/vehicles/${v.id}`); }} />}
    </div>
  );
}
