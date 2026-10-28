import type { ChartFacts } from '../lib/explain';
import type { ExplainLevel, Explanation, Scan, Settings, User, Vehicle } from '../lib/types';

/**
 * The ONLY thing the UI knows about data. Today it is backed by an in-browser mock (below).
 * Later, swap `api` for an implementation that calls FastAPI + Supabase; no screen has to change.
 */
export interface Api {
  getSession(): Promise<User | null>;
  signInWithGoogle(): Promise<User>;
  signInDemo(): Promise<User>;
  signOut(): Promise<void>;
  listVehicles(): Promise<Vehicle[]>;
  createVehicle(input: { name: string; modelYear: number | null }): Promise<Vehicle>;
  updateVehicle(id: string, input: { name: string; modelYear: number | null }): Promise<Vehicle>;
  deleteVehicle(id: string): Promise<void>;
  listScans(): Promise<Scan[]>;
  uploadScan(vehicleId: string, file: File, onStep: (step: number) => void): Promise<Scan>;
  deleteScan(id: string): Promise<void>;
  explainScan(scanId: string, level: ExplainLevel, settings: Settings): Promise<Explanation>;
  explainChart(facts: ChartFacts, level: ExplainLevel): Promise<Explanation>;
  loadDemoData(): Promise<void>;
  deleteAllData(): Promise<void>;
  exportData(): Promise<string>;
}

export const UPLOAD_STEPS = [
  'Reading file', 'Detecting format', 'Resampling to 1 Hz', 'Scoring signals', 'Checking against history',
];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface FileCheck {
  ok: boolean;
  source?: string;
  error?: string;
}

/** Cheap client-side checks. The real backend repeats these and does the actual parsing. */
export async function sniffFile(file: File): Promise<FileCheck> {
  if (!/\.csv$/i.test(file.name)) return { ok: false, error: 'Please upload a .csv file.' };
  if (file.size === 0) return { ok: false, error: 'This file is empty.' };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: 'This file is larger than 10 MB.' };
  const head = await file.slice(0, 4096).text();
  if (head.includes('%DataLog%')) return { ok: true, source: 'ECU datalog' };
  const first = head.split(/\r?\n/)[0] ?? '';
  if (first.includes(',') && /[a-z]/i.test(first)) return { ok: true, source: 'CSV log' };
  return { ok: false, error: 'This does not look like a CSV log we can read.' };
}
