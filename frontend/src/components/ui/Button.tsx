import clsx from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'soft' | 'ghost' | 'outline' | 'danger';
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
}

const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-contrast shadow-glow hover:brightness-110',
  soft: 'bg-primary-soft text-on-primary-soft hover:brightness-110',
  ghost: 'text-muted hover:bg-surface2 hover:text-ink',
  outline: 'border border-border bg-surface/60 text-ink hover:bg-surface2',
  danger: 'bg-pill-alert-bg text-pill-alert-fg hover:brightness-110',
};

export function Button({ variant = 'primary', size = 'md', icon, className, children, ...rest }: Props) {
  return (
    <button
      {...rest}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50',
        size === 'md' ? 'h-11 px-4 text-sm' : 'h-9 px-3 text-sm',
        variants[variant], className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
