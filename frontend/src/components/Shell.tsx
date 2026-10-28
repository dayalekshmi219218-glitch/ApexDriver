import clsx from 'clsx';
import { Car, LayoutDashboard, LineChart, LogOut, Moon, Settings as Cog, Sun } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useStore } from '../state/store';
import { isLive } from '../services/api';
import { Logo } from './Logo';
import { Toasts } from './ui/Toasts';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/vehicles', label: 'Vehicles', icon: Car, end: false },
  { to: '/analytics', label: 'Analytics', icon: LineChart, end: false },
  { to: '/settings', label: 'Settings', icon: Cog, end: false },
];

export function Shell() {
  const { user, settings, setSettings, signOut } = useStore();
  const nav = useNavigate();
  const dark = document.documentElement.classList.contains('dark');
  const initials = (user?.name ?? 'U').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

  return (
    <div className="min-h-screen md:grid md:grid-cols-[256px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col border-r border-border bg-surface/70 p-5 backdrop-blur md:flex">
        <Logo />
        <nav className="mt-8 space-y-1" aria-label="Main">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => clsx(
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                isActive ? 'bg-primary-soft text-on-primary-soft' : 'text-muted hover:bg-surface2 hover:text-ink',
              )}>
              <Icon size={18} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto">
          <div className="card !bg-surface2/70 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-contrast">{initials}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{user?.name}</div>
                <div className="truncate text-xs text-muted">{user?.email}</div>
              </div>
              <button aria-label="Sign out" title="Sign out" onClick={async () => { await signOut(); nav('/login'); }}
                className="rounded-lg p-2 text-muted hover:bg-surface3 hover:text-ink"><LogOut size={16} /></button>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0">
        <header className="flex items-center justify-between gap-3 px-4 pt-4 sm:px-8 md:justify-end">
          <div className="md:hidden"><Logo size={30} /></div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-border bg-surface2 px-3 py-1 text-xs font-medium text-muted sm:inline">
              {isLive ? 'Live API - dev sign-in' : 'Prototype - simulated analysis'}
            </span>
            <button aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
              onClick={() => setSettings({ theme: dark ? 'light' : 'dark' })}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface/70 text-muted transition hover:text-ink">
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-5 sm:px-8 md:pb-14" data-theme-key={settings.theme}>
          <Outlet />
        </main>
      </div>

      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => clsx('flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium', isActive ? 'text-primary' : 'text-muted')}>
            {({ isActive }) => (<><span className={clsx('rounded-full px-4 py-1', isActive && 'bg-primary-soft text-on-primary-soft')}><Icon size={20} /></span>{label}</>)}
          </NavLink>
        ))}
      </nav>
      <Toasts />
    </div>
  );
}
