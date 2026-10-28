import { Download, LogOut, Trash2, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Segmented } from '../components/ui/Segmented';
import { api, isLive } from '../services/api';
import { useStore } from '../state/store';

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-4">
      <div className="max-w-md"><div className="font-medium">{title}</div>{hint && <div className="text-sm text-muted">{hint}</div>}</div>
      {children}
    </div>
  );
}

export default function Settings() {
  const { user, settings, setSettings, loadDemo, wipe, signOut, notify, vehicles, scans } = useStore();
  const nav = useNavigate();
  const [confirm, setConfirm] = useState(false);

  const exportData = async () => {
    const blob = new Blob([await api.exportData()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'apexdriver-export.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    notify('Export downloaded');
  };

  return (
    <div className="animate-fade-up space-y-6">
      <div><h1 className="text-3xl font-bold">Settings</h1><p className="mt-1 text-muted">Units, explanations, appearance and your data.</p></div>

      <section className="card divide-y divide-border px-5 sm:px-6">
        <Row title="Temperature" hint="Applies to coolant and intake air readings.">
          <Segmented label="Temperature unit" value={settings.tempUnit} onChange={(v) => setSettings({ tempUnit: v })}
            options={[{ value: 'C', label: '°C' }, { value: 'F', label: '°F' }]} />
        </Row>
        <Row title="Speed" hint="Used when a log includes vehicle speed.">
          <Segmented label="Speed unit" value={settings.speedUnit} onChange={(v) => setSettings({ speedUnit: v })}
            options={[{ value: 'kmh', label: 'km/h' }, { value: 'mph', label: 'mph' }]} />
        </Row>
        <Row title="Explanation style" hint="Simple avoids jargon. Technical adds thresholds and terms.">
          <Segmented label="Explanation level" value={settings.explainLevel} onChange={(v) => setSettings({ explainLevel: v })}
            options={[{ value: 'simple', label: 'Simple' }, { value: 'technical', label: 'Technical' }]} />
        </Row>
        <Row title="Appearance">
          <Segmented label="Theme" value={settings.theme} onChange={(v) => setSettings({ theme: v })}
            options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]} />
        </Row>
      </section>

      <section className="card divide-y divide-border px-5 sm:px-6">
        <Row title="Your data" hint={`${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'} and ${scans.length} scan${scans.length === 1 ? '' : 's'} saved in this browser.`}>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" icon={<Wand2 size={14} />} onClick={async () => { await loadDemo(); notify('Demo vehicles added'); }}>Load demo data</Button>
            <Button variant="outline" size="sm" icon={<Download size={14} />} onClick={exportData}>Export my data</Button>
          </div>
        </Row>
        <Row title="Delete all my data" hint="Removes every vehicle, scan and report. This cannot be undone.">
          <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => setConfirm(true)}>Delete everything</Button>
        </Row>
      </section>

      <section className="card divide-y divide-border px-5 sm:px-6">
        <Row title={user?.name ?? 'Account'} hint={user?.email}>
          <Button variant="outline" size="sm" icon={<LogOut size={14} />} onClick={async () => { await signOut(); nav('/login'); }}>Sign out</Button>
        </Row>
      </section>

      <section className="card p-5 text-sm text-muted sm:p-6">
        <h2 className="mb-2 text-base font-semibold text-ink">About this prototype</h2>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>{isLive ? 'Google sign-in is simulated. Vehicles and scans are stored by your local API server.' : 'Google sign-in and the analysis are simulated in your browser. Nothing is uploaded anywhere.'}</li>
          <li>All demo vehicles and scans are synthetic and generated from parameters, not copied from any real dataset.</li>
          <li>The health ranges are generic defaults, and reports are not a mechanic's diagnosis.</li>
          <li>Data sources planned for the real version: Kaggle "Car ECU Datalogs" (author gxkok21, used only if the author agrees or you upload it yourself).</li>
        </ul>
      </section>

      {confirm && (
        <Modal title="Delete all your data?" onClose={() => setConfirm(false)}>
          <p className="text-sm text-muted">Every vehicle, scan and report will be removed from this browser.</p>
          <div className="mt-6 flex justify-end gap-3">
            <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button variant="danger" onClick={async () => { await wipe(); setConfirm(false); notify('All data deleted'); }}>Delete everything</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
