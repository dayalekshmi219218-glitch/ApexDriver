import { Download, Loader2 } from 'lucide-react';
import { useState } from 'react';
import type { Explanation, Scan, Settings, Vehicle } from '../lib/types';
import { Button } from './ui/Button';

/** The PDF library is loaded only when someone clicks, so it does not slow the first page load. */
export function DownloadPdfButton({ vehicle, scan, settings, explanation, onError }: {
  vehicle: Vehicle; scan: Scan; settings: Settings; explanation: Explanation | null; onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const click = async () => {
    setBusy(true);
    try {
      const [{ pdf }, { ReportPdf }] = await Promise.all([import('@react-pdf/renderer'), import('./ReportPdf')]);
      const blob = await pdf(<ReportPdf vehicle={vehicle} scan={scan} settings={settings} explanation={explanation} />).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const day = scan.startedAt.slice(0, 10);
      a.href = url;
      a.download = `ApexDriver-report-${vehicle.name.replace(/[^a-z0-9]+/gi, '-')}-${day}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      onError('Could not create the PDF. Please try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="soft" onClick={click} disabled={busy} icon={busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}>
      {busy ? 'Preparing PDF...' : 'Download PDF'}
    </Button>
  );
}
