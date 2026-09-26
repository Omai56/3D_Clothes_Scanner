import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fitReport, bodyLandmarks } from '../shared/fit.js';
import { createScanToken, scannerUrl, getScan, measurementsToCm, saveScanFiles } from './bodygram.js';
import { importProduct } from './importer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCANS_DIR = path.join(ROOT, 'data', 'scans');
const GARMENTS_DIR = path.join(ROOT, 'data', 'garments');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(ROOT, 'public')));
app.use('/shared', express.static(path.join(ROOT, 'shared')));
app.use('/scans', express.static(SCANS_DIR)); // .obj files

// ---------- helpers ----------
const safeName = (s) => /^[\w-]{1,64}$/.test(s);

async function readScan(name) {
  if (!safeName(name)) return null;
  try {
    const raw = JSON.parse(await fs.readFile(path.join(SCANS_DIR, `${name}.json`), 'utf8'));
    const measurements_cm = measurementsToCm(raw.measurements);
    return {
      name,
      id: raw.id,
      createdAt: raw.createdAt,
      input: raw.input ?? null,
      measurements_cm,
      landmarks_cm: bodyLandmarks(measurements_cm),
      objUrl: `/scans/${raw.avatarFile ?? name + '.obj'}`,
    };
  } catch {
    return null;
  }
}

async function listScans() {
  const files = (await fs.readdir(SCANS_DIR)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    const s = await readScan(f.replace(/\.json$/, ''));
    if (!s) continue;
    const pretty = s.name.charAt(0).toUpperCase() + s.name.slice(1);
    const label = s.name === 'demo' ? 'Demo body (175 cm)' : s.input?.photos ? `${pretty} (phone scan)` : pretty;
    out.push({ name: s.name, id: s.id, createdAt: s.createdAt, input: s.input, label });
  }
  return out.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

const saveScanEntry = (name, entry) => saveScanFiles(SCANS_DIR, name, entry);

async function listGarments() {
  const files = (await fs.readdir(GARMENTS_DIR)).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) out.push(JSON.parse(await fs.readFile(path.join(GARMENTS_DIR, f), 'utf8')));
  return out;
}

async function readGarment(id) {
  if (!safeName(id)) return null;
  try {
    return JSON.parse(await fs.readFile(path.join(GARMENTS_DIR, `${id}.json`), 'utf8'));
  } catch {
    return null;
  }
}

// ---------- body ----------
app.get('/api/scans', async (_req, res) => res.json(await listScans()));

app.get('/api/scans/:name', async (req, res) => {
  const s = await readScan(req.params.name);
  if (!s) return res.status(404).json({ error: 'scan not found' });
  res.json(s);
});

// Start a phone scan: returns the Bodygram scanner URL to open on the phone.
const sessions = new Map(); // sessionId -> { createdAt }
app.post('/api/scan-session', async (req, res) => {
  try {
    const sessionId = 'scan-' + crypto.randomBytes(4).toString('hex');
    const { token } = await createScanToken({ customScanId: sessionId, lifetimeSeconds: 3600 });
    const url = scannerUrl({ token, prefill: req.body?.prefill ?? {} });
    sessions.set(sessionId, { createdAt: Date.now() });
    res.json({ sessionId, url });
  } catch (e) {
    res.status(502).json({ error: String(e.message) });
  }
});

// Poll: has the phone scan for this session finished? If yes, save it and return the scan name.
app.get('/api/scan-session/:id', async (req, res) => {
  const sessionId = req.params.id;
  if (!safeName(sessionId)) return res.status(400).json({ error: 'bad id' });
  const existing = await readScan(sessionId);
  if (existing) return res.json({ ready: true, name: sessionId });
  try {
    const r = await fetch(`https://platform.bodygram.com/api/orgs/${process.env.BODYGRAM_ORG_ID}/scans?limit=20`, {
      headers: { Authorization: process.env.BODYGRAM_API_KEY },
    });
    const { results = [] } = await r.json();
    const hit = results.find((s) => s.customScanId === sessionId);
    if (!hit) return res.json({ ready: false });
    const entry = await getScan(hit.id);
    if (entry.status !== 'success') return res.json({ ready: false, failed: true, error: entry.error });
    await saveScanEntry(sessionId, entry);
    res.json({ ready: true, name: sessionId });
  } catch (e) {
    res.status(502).json({ error: String(e.message) });
  }
});

// ---------- garments ----------
app.get('/api/garments', async (_req, res) => res.json(await listGarments()));

app.get('/api/garments/:id', async (req, res) => {
  const g = await readGarment(req.params.id);
  if (!g) return res.status(404).json({ error: 'garment not found' });
  res.json(g);
});

// Try to pull a product from a store link. Falls back with a clear error so the UI can offer saved items.
app.post('/api/import', async (req, res) => {
  const url = String(req.body?.url ?? '').trim();
  if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: 'Paste a full product link (https://...)' });
  try {
    const result = await importProduct(url);
    res.json(result);
  } catch (e) {
    res.status(502).json({ error: String(e.message) });
  }
});

// ---------- fit ----------
app.post('/api/fit', async (req, res) => {
  const { scan, measurements_cm, garment_id, garment } = req.body ?? {};
  let body = measurements_cm;
  if (!body && scan) body = (await readScan(scan))?.measurements_cm;
  if (!body) return res.status(400).json({ error: 'need scan name or measurements_cm' });
  const g = garment ?? (await readGarment(garment_id));
  if (!g) return res.status(404).json({ error: 'garment not found' });
  try {
    res.json({ report: fitReport(body, g), body_cm: body, landmarks_cm: bodyLandmarks(body) });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`3D Clothes Scanner running at http://localhost:${PORT}`));
