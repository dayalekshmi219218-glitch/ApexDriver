import clsx from 'clsx';
import { ChevronDown, Sparkles, ShieldCheck, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExplainLevel, Explanation, Severity } from '../lib/types';
import { Button } from './ui/Button';
import { Pill } from './ui/Pill';
import { Segmented } from './ui/Segmented';

const urgency = { low: 'normal', medium: 'watch', high: 'alert' } as const;
const dot: Record<Severity, string> = { normal: 'bg-sev-normal', watch: 'bg-sev-watch', alert: 'bg-sev-alert', none: 'bg-sev-none' };

/**
 * "Explain in plain English" card. `fetcher` is the only thing it needs: today it returns a template
 * explanation, later the LLM endpoint returns the same shape.
 */
export function ExplainCard({ title = 'Explain this', fetcher, level, onLevel, auto = false, onLoaded, resetKey }: {
  title?: string;
  fetcher: (level: ExplainLevel) => Promise<Explanation>;
  level: ExplainLevel;
  onLevel: (l: ExplainLevel) => void;
  auto?: boolean;
  onLoaded?: (e: Explanation | null) => void;
  /** change this to throw away the current explanation (for example when a different scan is selected) */
  resetKey?: string;
}) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [exp, setExp] = useState<Explanation | null>(null);
  const [showCaveats, setShowCaveats] = useState(false);
  const run = useRef(0);

  const go = useCallback(async (lv: ExplainLevel) => {
    const my = ++run.current;
    setState('loading');
    try {
      const e = await fetcher(lv);
      if (my !== run.current) return;
      setExp(e);
      setState('done');
      onLoaded?.(e);
    } catch {
      if (my === run.current) setState('error');
    }
  }, [fetcher, onLoaded]);

  useEffect(() => {
    run.current++;
    setExp(null);
    setState('idle');
    onLoaded?.(null);
    if (auto) void go(level);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey, auto]);

  const changeLevel = (l: ExplainLevel) => {
    onLevel(l);
    if (state === 'done' || state === 'loading') void go(l);
  };

  return (
    <section className="card relative overflow-hidden p-5 sm:p-6" aria-label={title}>
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-primary/15 blur-3xl" aria-hidden />
      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-on-primary-soft"><Sparkles size={16} /></span>
          {title}
        </h3>
        <Segmented label="Explanation level" value={level} onChange={changeLevel}
          options={[{ value: 'simple', label: 'Simple' }, { value: 'technical', label: 'Technical' }]} />
      </div>

      {state === 'idle' && (
        <div className="relative mt-4 flex flex-wrap items-center gap-4">
          <Button onClick={() => void go(level)} icon={<Sparkles size={16} />}>Explain in plain English</Button>
          <p className="text-sm text-muted">Turns the numbers into a short, jargon-free summary.</p>
        </div>
      )}

      {state === 'loading' && (
        <div className="relative mt-5 space-y-3" aria-busy="true">
          <div className="flex items-center gap-2 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Writing the explanation...</div>
          <div className="skeleton h-6 w-3/4" /><div className="skeleton h-4 w-full" /><div className="skeleton h-4 w-5/6" /><div className="skeleton h-16 w-full" />
        </div>
      )}

      {state === 'error' && (
        <p className="relative mt-4 text-sm text-pill-alert-fg">Could not write the explanation. Please try again.
          <Button variant="ghost" size="sm" className="ml-2" onClick={() => void go(level)}>Retry</Button></p>
      )}

      {state === 'done' && exp && (
        <div className="relative mt-5 animate-fade-up space-y-5">
          <div>
            <h4 className="text-xl font-semibold leading-snug">{exp.headline}</h4>
            <p className="mt-2 text-muted">{exp.summary}</p>
          </div>
          {exp.findings.length > 0 && (
            <ul className="space-y-3">
              {exp.findings.map((f, i) => (
                <li key={i} className="flex gap-3">
                  <span className={clsx('mt-2 h-2.5 w-2.5 shrink-0 rounded-full', dot[f.severity])} aria-hidden />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{f.signal}</span>
                      {f.evidence.map((id) => {
                        const ev = exp.evidence.find((x) => x.id === id);
                        return (
                          <span key={id} title={ev?.text} className="cursor-help rounded border border-border bg-surface2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">{id}</span>
                        );
                      })}
                    </div>
                    <p className="text-sm text-muted">{f.text}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="rounded-xl bg-surface2 p-4 text-sm">{exp.meaning}</p>
          {exp.steps.length > 0 && (
            <div>
              <div className="label mb-2">What to do next</div>
              <ul className="space-y-2">
                {exp.steps.map((s, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <Pill severity={urgency[s.urgency]} label={s.urgency === 'high' ? 'Soon' : s.urgency === 'medium' ? 'This week' : 'Routine'} className="mt-0.5 shrink-0" />
                    <span>{s.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {exp.questions.length > 0 && (
            <div>
              <div className="label mb-2">Questions to ask a mechanic</div>
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted">{exp.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5 font-medium text-pill-normal-fg">
              <ShieldCheck size={14} /> {exp.faithfulness.matched} of {exp.faithfulness.checked} numbers match the report
            </span>
            <button onClick={() => setShowCaveats((v) => !v)} className="inline-flex items-center gap-1 hover:text-ink">
              Limits and notes <ChevronDown size={14} className={clsx('transition', showCaveats && 'rotate-180')} />
            </button>
          </div>
          {showCaveats && (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
              {exp.caveats.map((c, i) => <li key={i}>{c}</li>)}
              <li>Prototype: text is built from templates ({exp.model}); the language model plugs in here next.</li>
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
