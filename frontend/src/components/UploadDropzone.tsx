import clsx from 'clsx';
import { CheckCircle2, FileText, Loader2, UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { sniffFile, UPLOAD_STEPS } from '../services/api';
import { useStore } from '../state/store';

export function UploadDropzone({ vehicleId }: { vehicleId: string }) {
  const { addScanFile, notify } = useStore();
  const nav = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [step, setStep] = useState(-1);
  const busy = step >= 0;

  const start = async (f: File) => {
    setError('');
    const check = await sniffFile(f);
    if (!check.ok) { setFile(null); setError(check.error ?? 'Could not use this file.'); return; }
    setFile(f);
    setStep(0);
    try {
      const scan = await addScanFile(vehicleId, f, (n) => setStep(n));
      notify('Report ready');
      nav(`/scans/${scan.id}`);
    } catch (e) {
      setStep(-1);
      setError(e instanceof Error ? e.message : 'Upload failed.');
    }
  };

  return (
    <div>
      <div
        role="button" tabIndex={0} aria-label="Upload a scan file"
        onClick={() => !busy && input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !busy && input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f && !busy) void start(f); }}
        className={clsx(
          'flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-10 text-center transition',
          drag ? 'border-primary bg-primary/10' : 'border-border bg-surface2/60 hover:border-primary/60 hover:bg-surface2',
          busy && 'cursor-progress',
        )}
      >
        <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void start(f); e.target.value = ''; }} />
        {!busy ? (
          <>
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-on-primary-soft"><UploadCloud size={26} /></div>
            <p className="font-medium">Drop a trip log here, or click to choose a file</p>
            <p className="mt-1 text-sm text-muted">CSV only, up to 10 MB. One file is one scan.</p>
          </>
        ) : (
          <div className="w-full max-w-sm text-left" aria-live="polite">
            <div className="mb-4 flex items-center gap-2 text-sm font-medium"><FileText size={16} /> <span className="truncate">{file?.name}</span></div>
            <ul className="space-y-2.5">
              {UPLOAD_STEPS.map((label, i) => (
                <li key={label} className={clsx('flex items-center gap-2.5 text-sm', i > step ? 'text-subtle' : 'text-ink')}>
                  {i < step ? <CheckCircle2 size={16} className="text-sev-normal" /> : i === step ? <Loader2 size={16} className="animate-spin text-primary" /> : <span className="h-4 w-4 rounded-full border border-border" />}
                  {label}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-pill-alert-fg">{error}</p>}
    </div>
  );
}
