import { useState } from 'react';
import type { Vehicle } from '../lib/types';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

const MAX_YEAR = new Date().getFullYear() + 1;

export function VehicleDialog({ vehicle, onSave, onClose }: {
  vehicle?: Vehicle; onSave: (name: string, year: number | null) => Promise<void>; onClose: () => void;
}) {
  const [name, setName] = useState(vehicle?.name ?? '');
  const [year, setYear] = useState(vehicle?.modelYear ? String(vehicle.modelYear) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('Give the vehicle a name.');
    if (n.length > 40) return setError('Keep the name under 40 characters.');
    let y: number | null = null;
    if (year.trim()) {
      y = Number(year);
      if (!Number.isInteger(y) || y < 1980 || y > MAX_YEAR) return setError(`Model year must be between 1980 and ${MAX_YEAR}, or left empty.`);
    }
    setBusy(true);
    try { await onSave(n, y); onClose(); } catch { setError('Something went wrong. Please try again.'); setBusy(false); }
  };

  return (
    <Modal title={vehicle ? 'Rename vehicle' : 'Add a vehicle'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="label">Name</span>
          <input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} maxLength={50} placeholder="e.g. Daily hatchback"
            className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface2 px-3 text-sm outline-none focus:border-primary" />
        </label>
        <label className="block">
          <span className="label">Model year <span className="normal-case tracking-normal">(optional)</span></span>
          <input value={year} onChange={(e) => { setYear(e.target.value); setError(''); }} inputMode="numeric" placeholder="e.g. 2018"
            className="mt-1.5 h-11 w-full rounded-xl border border-border bg-surface2 px-3 text-sm outline-none focus:border-primary" />
        </label>
        {error && <p role="alert" className="text-sm text-pill-alert-fg">{error}</p>}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{vehicle ? 'Save' : 'Add vehicle'}</Button>
        </div>
      </form>
    </Modal>
  );
}
