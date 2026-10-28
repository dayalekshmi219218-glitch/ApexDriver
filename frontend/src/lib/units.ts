import { SIGNALS } from './config';
import type { Settings, SignalKey } from './types';

export const cToF = (c: number): number => (c * 9) / 5 + 32;
export const kmhToMph = (k: number): number => k * 0.621371;

/** Convert a stored (metric) value to the user's display unit. */
export function toDisplay(key: SignalKey, value: number, s: Pick<Settings, 'tempUnit'>): number {
  return SIGNALS[key].isTemp && s.tempUnit === 'F' ? cToF(value) : value;
}

export function unitFor(key: SignalKey, s: Pick<Settings, 'tempUnit'>): string {
  if (SIGNALS[key].isTemp) return s.tempUnit === 'F' ? '°F' : '°C';
  return SIGNALS[key].unit;
}

export function fmtNum(v: number, key?: SignalKey): string {
  if (!Number.isFinite(v)) return '-';
  const abs = Math.abs(v);
  const digits = key === 'rpm' || abs >= 1000 ? 0 : key === 'battery_v' || key === 'afr' ? 2 : abs >= 100 ? 0 : 1;
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

export function fmtValue(key: SignalKey, v: number, s: Pick<Settings, 'tempUnit'>): string {
  return `${fmtNum(toDisplay(key, v, s), key)} ${unitFor(key, s)}`.trim();
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function timeAgo(iso: string, now = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}
