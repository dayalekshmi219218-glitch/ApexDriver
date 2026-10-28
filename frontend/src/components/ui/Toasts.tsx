import clsx from 'clsx';
import { CheckCircle2, AlertTriangle } from 'lucide-react';
import { useStore } from '../../state/store';

export function Toasts() {
  const { toasts } = useStore();
  return (
    <div className="pointer-events-none fixed bottom-20 right-4 z-[60] flex flex-col gap-2 md:bottom-6" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={clsx(
            'card pointer-events-auto flex animate-fade-up items-center gap-2 px-4 py-3 text-sm font-medium !bg-surface',
            t.kind === 'error' ? 'text-pill-alert-fg' : 'text-ink',
          )}
        >
          {t.kind === 'error' ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} className="text-sev-normal" />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
