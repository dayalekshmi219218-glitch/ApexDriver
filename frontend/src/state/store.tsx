import { supabase } from '../lib/supabase';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from '../services/api';
import type { Scan, Settings, User, Vehicle } from '../lib/types';

const UI_KEY = 'apexdriver.ui';
export const DEFAULT_SETTINGS: Settings = { tempUnit: 'C', speedUnit: 'kmh', explainLevel: 'simple', theme: 'dark' };

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(UI_KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function applyTheme(theme: Settings['theme']): void {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

export interface Toast {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

interface Store {
  ready: boolean;
  user: User | null;
  vehicles: Vehicle[];
  scans: Scan[];
  settings: Settings;
  toasts: Toast[];
  notify: (text: string, kind?: Toast['kind']) => void;
  setSettings: (patch: Partial<Settings>) => void;
  signInGoogle: () => Promise<void>;
  signInDemo: () => Promise<void>;
  signOut: () => Promise<void>;
  addVehicle: (name: string, year: number | null) => Promise<Vehicle>;
  editVehicle: (id: string, name: string, year: number | null) => Promise<void>;
  removeVehicle: (id: string) => Promise<void>;
  addScanFile: (vehicleId: string, file: File, onStep: (n: number) => void) => Promise<Scan>;
  removeScan: (id: string) => Promise<void>;
  loadDemo: () => Promise<void>;
  wipe: () => Promise<void>;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [scans, setScans] = useState<Scan[]>([]);
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const refresh = useCallback(async () => {
    const [v, s] = await Promise.all([api.listVehicles(), api.listScans()]);
    setVehicles(v);
    setScans(s);
  }, []);

  useEffect(() => {
    (async () => {
      const u = await api.getSession();
      setUser(u);
      if (u) await refresh();
      setReady(true);
    })();
  }, [refresh]);

  useEffect(() => {
    applyTheme(settings.theme);
    try { localStorage.setItem(UI_KEY, JSON.stringify(settings)); } catch { /* ignore */ }
    if (settings.theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [settings]);

  const notify = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);

  const value = useMemo<Store>(() => ({
    ready, user, vehicles, scans, settings, toasts, notify,
    setSettings: (patch) => setSettingsState((s) => ({ ...s, ...patch })),
    signInGoogle: async () => {try {
    const u = await api.signInWithGoogle();
    setUser(u);
    await refresh();
  } catch (e) {
    // The OAuth call always "fails" with a redirect error by design.
    // If it's a real error (network, config), the caller's toast will surface it.
    if (!(e instanceof Error) || !e.message.includes('Redirecting')) {
      throw e;
    }
  } },
    signInDemo: async () => { setUser(await api.signInDemo()); await refresh(); },
    signOut: async () => { await api.signOut(); setUser(null); setVehicles([]); setScans([]); },
    addVehicle: async (name, year) => { const v = await api.createVehicle({ name, modelYear: year }); await refresh(); return v; },
    editVehicle: async (id, name, year) => { await api.updateVehicle(id, { name, modelYear: year }); await refresh(); },
    removeVehicle: async (id) => { await api.deleteVehicle(id); await refresh(); },
    addScanFile: async (vehicleId, file, onStep) => { const s = await api.uploadScan(vehicleId, file, onStep); await refresh(); return s; },
    removeScan: async (id) => { await api.deleteScan(id); await refresh(); },
    loadDemo: async () => { await api.loadDemoData(); await refresh(); },
    wipe: async () => { await api.deleteAllData(); await refresh(); },
  }), [ready, user, vehicles, scans, settings, toasts, notify, refresh]);
      useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        const u = await api.getSession();
        setUser(u);
        if (u) await refresh();
      } else if (event === 'SIGNED_OUT') {
        setUser(null);
        setVehicles([]);
        setScans([]);
      }
    });
    return () => subscription.unsubscribe();
  }, [refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore must be used inside StoreProvider');
  return v;
}

/** Scans of one vehicle, oldest first. */
export function useVehicleScans(vehicleId: string | undefined): Scan[] {
  const { scans } = useStore();
  return useMemo(
    () => scans.filter((s) => s.vehicleId === vehicleId).sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    [scans, vehicleId],
  );
}
