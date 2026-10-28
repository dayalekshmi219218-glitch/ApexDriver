import { BarChart3, FileText, ShieldCheck, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Gauge } from '../components/Gauge';
import { Logo } from '../components/Logo';
import { Button } from '../components/ui/Button';
import { Pill } from '../components/ui/Pill';
import { isLive } from '../services/api';
import { useStore } from '../state/store';

const FEATURES = [
  { icon: FileText, title: 'A health report in seconds', text: 'Upload a trip log and see every reading against its healthy range.' },
  { icon: BarChart3, title: 'Trends across scans', text: 'Spot a battery sagging or an engine running hotter, before it becomes a breakdown.' },
  { icon: Sparkles, title: 'Plain-English explanations', text: 'No jargon. Every number in the explanation is checked against your report.' },
];

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3A12 12 0 1 1 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7A20 20 0 1 0 44 24c0-1.3-.1-2.7-.4-3.9z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0 1 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9z" />
    </svg>
  );
}

export default function Login() {
  const { user, ready, signInGoogle, signInDemo } = useStore();
  const nav = useNavigate();
  const [busy, setBusy] = useState<'google' | 'demo' | null>(null);
  if (ready && user) return <Navigate to="/" replace />;

  const go = async (kind: 'google' | 'demo') => {
    setBusy(kind);
    await (kind === 'google' ? signInGoogle() : signInDemo());
    nav('/');
  };

  return (
    <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-[1.15fr_1fr]">
      <section className="order-2 lg:order-1">
        <Logo size={40} />
        <h1 className="mt-10 max-w-xl text-4xl font-bold leading-[1.1] sm:text-5xl">
          Understand what your car is <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">telling you</span>.
        </h1>
        <p className="mt-5 max-w-lg text-lg text-muted">
          Upload an OBD log. Get a clear health report, trends over time, and an explanation anyone can follow.
        </p>
        <ul className="mt-9 space-y-5">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-on-primary-soft"><Icon size={20} /></span>
              <div><div className="font-semibold">{title}</div><div className="text-sm text-muted">{text}</div></div>
            </li>
          ))}
        </ul>
      </section>

      <section className="order-1 lg:order-2">
        <div className="relative">
          <div className="card relative mx-auto flex max-w-sm animate-float flex-col items-center p-8 shadow-glow">
            <Gauge value={87} severity="normal" size={210} />
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Pill severity="normal" label="Coolant Normal" /><Pill severity="watch" label="Battery Watch" />
            </div>
          </div>
        </div>
        <div className="card mx-auto mt-8 max-w-sm p-6">
          <h2 className="text-xl font-semibold">Welcome</h2>
          <p className="mt-1 text-sm text-muted">Sign in to save your vehicles and scans.</p>
          <Button variant="outline" className="mt-5 w-full !bg-white !text-neutral-900 hover:!bg-neutral-100" onClick={() => go('google')} disabled={busy !== null}
            icon={<GoogleG />}>{busy === 'google' ? 'Signing in...' : 'Continue with Google'}</Button>
          <div className="my-4 flex items-center gap-3 text-xs text-subtle"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
          <Button className="w-full" onClick={() => go('demo')} disabled={busy !== null}>{busy === 'demo' ? 'Opening demo...' : 'Try the demo'}</Button>
          <p className="mt-4 flex items-start gap-2 text-xs text-muted">
            <ShieldCheck size={14} className="mt-0.5 shrink-0" />
            {isLive
              ? 'Dev mode: Google sign-in is simulated. Uploads are analysed by your local API server; the demo uses synthetic vehicles.'
              : 'Prototype: Google sign-in is simulated and the demo uses synthetic vehicles. Nothing leaves your browser.'}
          </p>
        </div>
      </section>
    </div>
  );
}
