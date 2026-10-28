import { detectAnomalies } from '../lib/anomaly';
import { buildChartExplanation, buildExplanation } from '../lib/explain';
import { seedDemo, simulateUpload } from '../lib/synth';
import type { Scan, User, Vehicle } from '../lib/types';
import { sniffFile, UPLOAD_STEPS, type Api } from './apiTypes';

/** In-browser stand-in for the backend. Used when VITE_API_URL is not set. */
interface Db {
  user: User | null;
  vehicles: Vehicle[];
  scans: Scan[];
}

const KEY = 'apexdriver.mock.v1';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function read(): Db {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Db;
  } catch { /* fall through to empty */ }
  return { user: null, vehicles: [], scans: [] };
}

function write(db: Db): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch { /* storage full or blocked: the prototype keeps working in memory only */ }
}

export const mockApi: Api = {
  async getSession() {
    return read().user;
  },
  async signInWithGoogle() {
    await sleep(500);
    const db = read();
    db.user = { id: 'u-google', name: 'Alex Driver', email: 'alex.driver@example.com', demo: false };
    write(db);
    return db.user;
  },
  async signInDemo() {
    await sleep(300);
    const db = read();
    db.user = { id: 'u-demo', name: 'Demo user', email: 'demo@apexdriver.app', demo: true };
    if (db.vehicles.length === 0) {
      const demo = seedDemo();
      db.vehicles = demo.vehicles;
      db.scans = demo.scans;
    }
    write(db);
    return db.user;
  },
  async signOut() {
    const db = read();
    db.user = null;
    write(db);
  },
  async listVehicles() {
    return read().vehicles;
  },
  async createVehicle({ name, modelYear }) {
    await sleep(150);
    const db = read();
    const v: Vehicle = {
      id: `veh-${Date.now().toString(36)}`, name: name.trim(), modelYear, createdAt: new Date().toISOString(), synthetic: false,
    };
    db.vehicles = [v, ...db.vehicles];
    write(db);
    return v;
  },
  async updateVehicle(id, { name, modelYear }) {
    await sleep(100);
    const db = read();
    const v = db.vehicles.find((x) => x.id === id);
    if (!v) throw new Error('Vehicle not found');
    v.name = name.trim();
    v.modelYear = modelYear;
    write(db);
    return { ...v };
  },
  async deleteVehicle(id) {
    await sleep(150);
    const db = read();
    // cascade, exactly like the planned database foreign keys
    db.vehicles = db.vehicles.filter((v) => v.id !== id);
    db.scans = db.scans.filter((s) => s.vehicleId !== id);
    write(db);
  },
  async listScans() {
    return read().scans;
  },
  async uploadScan(vehicleId, file, onStep) {
    const check = await sniffFile(file);
    if (!check.ok) throw new Error(check.error);
    const db = read();
    const vehicle = db.vehicles.find((v) => v.id === vehicleId);
    if (!vehicle) throw new Error('Vehicle not found');
    for (let i = 0; i < UPLOAD_STEPS.length; i++) {
      onStep(i);
      await sleep(420);
    }
    const scan = simulateUpload(vehicle, file.name, file.size, check.source ?? 'CSV log');
    db.scans = [...db.scans, scan];
    write(db);
    onStep(UPLOAD_STEPS.length);
    return scan;
  },
  async deleteScan(id) {
    const db = read();
    db.scans = db.scans.filter((s) => s.id !== id);
    write(db);
  },
  async explainScan(scanId, level, settings) {
    await sleep(900);
    const db = read();
    const scan = db.scans.find((s) => s.id === scanId);
    if (!scan) throw new Error('Scan not found');
    const vehicle = db.vehicles.find((v) => v.id === scan.vehicleId);
    if (!vehicle) throw new Error('Vehicle not found');
    const anomalies = detectAnomalies(db.scans.filter((s) => s.vehicleId === vehicle.id)).anomalies.filter((a) => a.scanId === scanId);
    return buildExplanation(scan, vehicle, settings, level, anomalies);
  },
  async explainChart(facts, level) {
    await sleep(700);
    return buildChartExplanation(facts, level);
  },
  async loadDemoData() {
    await sleep(250);
    const db = read();
    const demo = seedDemo();
    const have = new Set(db.vehicles.map((v) => v.id));
    for (const v of demo.vehicles) if (!have.has(v.id)) db.vehicles.push(v);
    const haveScans = new Set(db.scans.map((s) => s.id));
    for (const s of demo.scans) if (!haveScans.has(s.id)) db.scans.push(s);
    write(db);
  },
  async deleteAllData() {
    await sleep(200);
    const db = read();
    db.vehicles = [];
    db.scans = [];
    write(db);
  },
  async exportData() {
    const db = read();
    return JSON.stringify({ exportedAt: new Date().toISOString(), user: db.user, vehicles: db.vehicles, scans: db.scans }, null, 2);
  },
};
