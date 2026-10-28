import { ArrowLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { TrendChart } from '../components/TrendChart';
import { UploadDropzone } from '../components/UploadDropzone';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { Chip, Pill } from '../components/ui/Pill';
import { VehicleDialog } from '../components/VehicleDialog';
import { detectAnomalies } from '../lib/anomaly';
import { fmtDateTime, fmtShortDate } from '../lib/units';
import type { Scan } from '../lib/types';
import { isLive } from '../services/api';
import { useStore, useVehicleScans } from '../state/store';
import { DeleteVehicleModal } from './Vehicles';

export default function VehicleDetail() {
  const { id } = useParams();
  const { vehicles, editVehicle, removeVehicle, removeScan, notify } = useStore();
  const vehicle = vehicles.find((v) => v.id === id);
  const scans = useVehicleScans(id);
  const nav = useNavigate();
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [delScan, setDelScan] = useState<Scan | null>(null);

  const anomalyCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of detectAnomalies(scans).anomalies) m.set(a.scanId, (m.get(a.scanId) ?? 0) + 1);
    return m;
  }, [scans]);

  if (!vehicle) {
    return <EmptyState icon={<Trash2 size={24} />} title="Vehicle not found" text="It may have been deleted."
      action={<Link to="/vehicles"><Button variant="soft">Back to vehicles</Button></Link>} />;
  }
  const points = scans.map((s) => ({ scanId: s.id, label: fmtShortDate(s.startedAt), value: s.score, anomaly: false }));

  return (
    <div className="animate-fade-up space-y-6">
      <div>
        <Link to="/vehicles" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><ArrowLeft size={14} /> Vehicles</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">{vehicle.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-muted">
              <span>{vehicle.modelYear ?? 'Year unknown'}</span>
              <span aria-hidden>·</span><span>{scans.length} scan{scans.length === 1 ? '' : 's'}</span>
              {vehicle.synthetic && <Chip>Synthetic demo data</Chip>}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" icon={<Pencil size={14} />} onClick={() => setEdit(true)}>Rename</Button>
            <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => setDel(true)}>Delete</Button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-5 sm:p-6">
          <h2 className="mb-4 text-lg font-semibold">Add a scan</h2>
          <UploadDropzone vehicleId={vehicle.id} />
          <p className="mt-3 text-xs text-subtle">{isLive ? 'Supported now: ECU datalogs (CSV) from ECU Manager. Your file is analysed by the API server.' : 'Prototype: files are checked here, but the analysis is simulated until the backend is connected.'}</p>
        </section>
        <section className="card p-5 sm:p-6">
          <h2 className="mb-2 text-lg font-semibold">Health score over time</h2>
          {points.length < 2 ? (
            <p className="py-16 text-center text-sm text-muted">Upload at least two scans to see a trend.</p>
          ) : (
            <TrendChart points={points} baseline={null} unit="/ 100" onSelect={(sid) => nav(`/scans/${sid}`)} />
          )}
        </section>
      </div>

      <section className="card overflow-hidden">
        <div className="border-b border-border px-5 py-4 sm:px-6"><h2 className="text-lg font-semibold">Scans</h2></div>
        {scans.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-muted">No scans yet. Drop a trip log above to generate the first report.</p>
        ) : (
          <ul className="divide-y divide-border">
            {[...scans].reverse().map((s) => (
              <li key={s.id} className="group flex items-center gap-3 px-5 py-3.5 transition hover:bg-surface2 sm:px-6">
                <Link to={`/scans/${s.id}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-6 gap-y-1">
                  <span className="w-40 font-medium">{fmtDateTime(s.startedAt)}</span>
                  <span className="flex items-center gap-2"><b className="w-8 font-display text-lg tabular-nums">{s.score}</b><Pill severity={s.severity} /></span>
                  <span className="text-sm text-muted">{s.durationMin} min · {s.scoredSignals} of {s.totalSignals} signals</span>
                  {(anomalyCount.get(s.id) ?? 0) > 0 && <Pill severity="watch" label={`${anomalyCount.get(s.id)} unusual`} />}
                </Link>
                <button aria-label="Delete scan" title="Delete scan" onClick={() => setDelScan(s)} className="rounded-lg p-2 text-muted hover:bg-pill-alert-bg hover:text-pill-alert-fg"><Trash2 size={16} /></button>
                <Link to={`/scans/${s.id}`} aria-label="Open report" className="text-subtle"><ChevronRight size={18} /></Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {edit && <VehicleDialog vehicle={vehicle} onClose={() => setEdit(false)} onSave={async (n, y) => { await editVehicle(vehicle.id, n, y); notify('Vehicle renamed'); }} />}
      {del && <DeleteVehicleModal vehicle={vehicle} scanCount={scans.length} onClose={() => setDel(false)}
        onConfirm={async () => { await removeVehicle(vehicle.id); notify('Vehicle deleted'); nav('/vehicles'); }} />}
      {delScan && (
        <Modal title="Delete this scan?" onClose={() => setDelScan(null)}>
          <p className="text-sm text-muted">The report for {fmtDateTime(delScan.startedAt)} will be removed. Trends will update.</p>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setDelScan(null)}>Cancel</Button>
            <Button variant="danger" onClick={async () => { await removeScan(delScan.id); setDelScan(null); notify('Scan deleted'); }}>Delete</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
