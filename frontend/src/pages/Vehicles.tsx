import { Car, Pencil, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Gauge } from '../components/Gauge';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { Chip } from '../components/ui/Pill';
import { VehicleDialog } from '../components/VehicleDialog';
import { fmtShortDate } from '../lib/units';
import type { Scan, Vehicle } from '../lib/types';
import { useStore } from '../state/store';

export function DeleteVehicleModal({ vehicle, scanCount, onClose, onConfirm }: {
  vehicle: Vehicle; scanCount: number; onClose: () => void; onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Delete this vehicle?" onClose={onClose}>
      <p className="text-sm text-muted">
        <b className="text-ink">{vehicle.name}</b> and its {scanCount} scan{scanCount === 1 ? '' : 's'}, reports and analysis will be permanently removed. This cannot be undone.
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="danger" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(); }} icon={<Trash2 size={16} />}>Delete</Button>
      </div>
    </Modal>
  );
}

export default function Vehicles() {
  const { vehicles, scans, addVehicle, editVehicle, removeVehicle, loadDemo, notify } = useStore();
  const nav = useNavigate();
  const [dialog, setDialog] = useState<'new' | Vehicle | null>(null);
  const [del, setDel] = useState<Vehicle | null>(null);

  const stats = useMemo(() => {
    const m = new Map<string, { count: number; last: Scan | null }>();
    for (const v of vehicles) m.set(v.id, { count: 0, last: null });
    for (const s of scans) {
      const e = m.get(s.vehicleId);
      if (!e) continue;
      e.count++;
      if (!e.last || s.startedAt > e.last.startedAt) e.last = s;
    }
    return m;
  }, [vehicles, scans]);

  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Vehicles</h1>
          <p className="mt-1 text-muted">Add a vehicle, then upload trip logs to build its health history.</p>
        </div>
        <Button icon={<Plus size={16} />} onClick={() => setDialog('new')}>Add vehicle</Button>
      </div>

      {vehicles.length === 0 ? (
        <EmptyState icon={<Car size={26} />} title="No vehicles yet" text="Add your first vehicle, or load a few synthetic ones to explore."
          action={<>
            <Button icon={<Plus size={16} />} onClick={() => setDialog('new')}>Add a vehicle</Button>
            <Button variant="outline" onClick={async () => { await loadDemo(); notify('Demo vehicles added'); }}>Load demo data</Button>
          </>} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((v) => {
            const st = stats.get(v.id)!;
            return (
              <article key={v.id} className="card group relative p-5 transition hover:shadow-glow">
                <Link to={`/vehicles/${v.id}`} className="absolute inset-0 rounded-2xl" aria-label={`Open ${v.name}`} />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold">{v.name}</h2>
                    <p className="text-sm text-muted">{v.modelYear ?? 'Year unknown'}</p>
                    {v.synthetic && <Chip className="mt-2">Synthetic demo data</Chip>}
                  </div>
                  <div className="relative z-10 flex gap-1">
                    <button aria-label={`Rename ${v.name}`} title="Rename" onClick={() => setDialog(v)} className="rounded-lg p-2 text-muted hover:bg-surface2 hover:text-ink"><Pencil size={16} /></button>
                    <button aria-label={`Delete ${v.name}`} title="Delete" onClick={() => setDel(v)} className="rounded-lg p-2 text-muted hover:bg-pill-alert-bg hover:text-pill-alert-fg"><Trash2 size={16} /></button>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-4">
                  {st.last ? <Gauge value={st.last.score} severity={st.last.severity} size={104} showLabel={false} caption="" /> : (
                    <div className="flex h-[104px] w-[104px] items-center justify-center rounded-full border-2 border-dashed border-border text-xs text-muted">no scans</div>
                  )}
                  <div className="text-sm">
                    <div><b className="font-display text-xl tabular-nums">{st.count}</b> <span className="text-muted">scan{st.count === 1 ? '' : 's'}</span></div>
                    <div className="mt-1 text-muted">{st.last ? `Last ${fmtShortDate(st.last.startedAt)}` : 'Upload a log to begin'}</div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {dialog && (
        <VehicleDialog
          vehicle={dialog === 'new' ? undefined : dialog} onClose={() => setDialog(null)}
          onSave={async (n, y) => {
            if (dialog === 'new') { const v = await addVehicle(n, y); notify('Vehicle added'); nav(`/vehicles/${v.id}`); }
            else { await editVehicle(dialog.id, n, y); notify('Vehicle renamed'); }
          }}
        />
      )}
      {del && (
        <DeleteVehicleModal vehicle={del} scanCount={stats.get(del.id)?.count ?? 0} onClose={() => setDel(null)}
          onConfirm={async () => { await removeVehicle(del.id); setDel(null); notify('Vehicle deleted'); }} />
      )}
    </div>
  );
}
