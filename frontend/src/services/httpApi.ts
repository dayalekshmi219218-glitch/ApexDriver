import { detectAnomalies } from '../lib/anomaly';
import { buildChartExplanation, buildExplanation } from '../lib/explain';
import { seedDemo } from '../lib/synth';
import type { Scan, User, Vehicle } from '../lib/types';
import { sniffFile, UPLOAD_STEPS, type Api } from './apiTypes';

/**
 * Real backend (FastAPI). Chosen when VITE_API_URL is set, e.g. VITE_API_URL=http://localhost:8000
 *
 * Interim pieces that are still local until their backend slices exist:
 *   - sign-in (slice 3: Google via Supabase). For now the user id is sent in the X-Dev-User header.
/**/
export const API_URL: string | undefined = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/$/, '') || undefined;

const USER_KEY = 'apexdriver.http.user';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readUser(): User | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') as User | null;
  } catch {
    return null;
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
    if (Array.isArray(body.detail) && body.detail.length > 0) {
      const first = body.detail[0] as { msg?: string };
      if (first.msg) return first.msg.replace(/^Value error, /, '');
    }
  } catch { /* not JSON */ }
  return `Request failed (${res.status}).`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const user = readUser();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...init, headers: { ...(user ? { 'X-Dev-User': user.id } : {}), ...init.headers } });
  } catch {
    throw new Error('Cannot reach the ApexDriver server. Is it running?');
  }
  if (!res.ok) throw new Error(await errorMessage(res));
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function loadAllScans(): Promise<Scan[]> {
  return request<Scan[]>('/scans');
}

export const httpApi: Api = {
  async getSession() {
    return readUser();
  },
  async signInWithGoogle() {
    const u: User = { id: 'u-google', name: 'Alex Driver', email: 'alex.driver@example.com', demo: false };
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    return u;
  },
  async signInDemo() {
    const u: User = { id: 'u-demo', name: 'Demo user', email: 'demo@apexdriver.app', demo: true };
    localStorage.setItem(USER_KEY, JSON.stringify(u));
    if ((await request<Vehicle[]>('/vehicles')).length === 0) await httpApi.loadDemoData();
    return u;
  },
  async signOut() {
    localStorage.removeItem(USER_KEY);
  },
  listVehicles: () => request<Vehicle[]>('/vehicles'),
  createVehicle: ({ name, modelYear }) => request<Vehicle>('/vehicles', json({ name, modelYear })),
  updateVehicle: (id, { name, modelYear }) =>
    request<Vehicle>(`/vehicles/${id}`, { ...json({ name, modelYear }), method: 'PATCH' }),
  async deleteVehicle(id) {
    await request<void>(`/vehicles/${id}`, { method: 'DELETE' });
  },
  listScans: loadAllScans,

  async uploadScan(vehicleId, file, onStep) {
    const check = await sniffFile(file);                 // instant feedback; the server repeats these checks
    if (!check.ok) throw new Error(check.error);
    let step = 0;
    onStep(step);
    const form = new FormData();
    form.append('vehicle_id', vehicleId);
    form.append('file', file);
    const accepted = await request<{ id: string }>('/scans', { method: 'POST', body: form });
    let tick = 0;
    for (let i = 0; i < 150; i++) {                      // poll for up to about a minute
      await sleep(400);
      const s = await request<Scan & { status: string; error?: string }>(`/scans/${accepted.id}`);
      if (s.status === 'failed') throw new Error(s.error ?? 'The file could not be analysed.');
      if (s.status === 'ready') {
        for (step = Math.max(step, 1); step < UPLOAD_STEPS.length; step++) { onStep(step); await sleep(220); }
        onStep(UPLOAD_STEPS.length);
        return s;
      }
      if (++tick % 2 === 0 && step < UPLOAD_STEPS.length - 1) onStep(++step);
    }
    throw new Error('Analysis is taking longer than expected. Please check back in a moment.');
  },

  async deleteScan(id) {
    await request<void>(`/scans/${id}`, { method: 'DELETE' });
  },

  async explainScan(scanId, level, settings) {
    const [scan, vehicles] = await Promise.all([request<Scan>(`/scans/${scanId}`), request<Vehicle[]>('/vehicles')]);
    const vehicle = vehicles.find((v) => v.id === scan.vehicleId);
    if (!vehicle) throw new Error('Vehicle not found');
    const siblings = await request<Scan[]>(`/scans?vehicle_id=${scan.vehicleId}`);
    const anomalies = detectAnomalies(siblings).anomalies.filter((a) => a.scanId === scanId);
    await sleep(700);
    return buildExplanation(scan, vehicle, settings, level, anomalies);
  },
  async explainChart(facts, level) {
    await sleep(600);
    return buildChartExplanation(facts, level);
  },

  async loadDemoData() {
    const demo = seedDemo();
    const have = new Set((await request<Vehicle[]>('/vehicles')).map((v) => v.name));
    for (const dv of demo.vehicles) {
      if (have.has(dv.name)) continue;
      const v = await request<Vehicle>('/vehicles', json({ name: dv.name, modelYear: dv.modelYear, synthetic: true }));
      for (const s of demo.scans.filter((x) => x.vehicleId === dv.id)) {
        await request<Scan>('/scans/import', json({
          vehicleId: v.id, series: s.series, startedAt: s.startedAt, durationMin: s.durationMin,
          source: s.source, fileName: s.fileName, simulated: true,
        }));
      }
    }
  },
  async deleteAllData() {
    await request<void>('/me/data', { method: 'DELETE' });
  },
  async exportData() {
    return JSON.stringify(await request<unknown>('/me/export'), null, 2);
  },
};
