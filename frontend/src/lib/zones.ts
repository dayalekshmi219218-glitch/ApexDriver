import { SIGNALS } from './config';
import { fmtNum, toDisplay, unitFor } from './units';
import type { Settings, SignalKey } from './types';

/** Human-readable "ranges used" text for a signal, in the user's units (printed on the report). */
export function rangeSummary(key: SignalKey, s: Pick<Settings, 'tempUnit'>): string {
  const c = SIGNALS[key];
  if (!c.scored) return 'Shown for context, not scored';
  const u = unitFor(key, s);
  const f = (v: number) => fmtNum(toDisplay(key, v, s), key);
  const cfg = c.cfg;
  if (cfg.direction === 'both') {
    return `Normal ${f(cfg.normalMin!)} to ${f(cfg.normalMax!)} ${u}; Watch ${f(cfg.moderateMin!)} to ${f(cfg.normalMin!)} or ${f(cfg.normalMax!)} to ${f(cfg.moderateMax!)}; Alert outside`;
  }
  return `Normal up to ${f(cfg.normalMax!)} ${u}; Watch up to ${f(cfg.moderateMax!)}; Alert above`;
}
