import clsx from 'clsx';
import { severityLabel } from '../../lib/scoring';
import type { Severity } from '../../lib/types';

const styles: Record<Severity, string> = {
  normal: 'bg-pill-normal-bg text-pill-normal-fg',
  watch: 'bg-pill-watch-bg text-pill-watch-fg',
  alert: 'bg-pill-alert-bg text-pill-alert-fg',
  none: 'bg-pill-none-bg text-pill-none-fg',
};
const dots: Record<Severity, string> = {
  normal: 'bg-sev-normal', watch: 'bg-sev-watch', alert: 'bg-sev-alert', none: 'bg-sev-none',
};

export function Pill({ severity, label, className }: { severity: Severity; label?: string; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', styles[severity], className)}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', dots[severity])} aria-hidden />
      {label ?? severityLabel(severity)}
    </span>
  );
}

export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full border border-border bg-surface2 px-2.5 py-1 text-xs font-medium text-muted', className)}>
      {children}
    </span>
  );
}
