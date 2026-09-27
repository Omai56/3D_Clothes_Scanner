import 'dotenv/config';
import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { fitReport, bodyLandmarks } from '../shared/fit.js';
import { createScanToken, scannerUrl, getScan, measurementsToCm, saveScanFiles } from './bodygram.js';
import { importProduct } from './importer.js';
import { importZara } from './zara.js';
import { startImageTo3D, getTask as getMeshyTask } from './meshy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCANS_DIR = path.join(ROOT, 'data', 'scans');
const GARMENTS_DIR = path.join(ROOT, 'data', 'garments');
const MODELS_DIR = path.join(ROOT, 'data', 'models');

const app = express();
app.use(express.json({ limit: '2mb' }));
// phones cache module scripts aggressively; the app is tiny, always fetch fresh code
const noStore = { setHeaders: (res, file) => { if (/\.(js|css|html)$/.test(file)) res.setHeader('Cache-Control', 'no-store'); } };
app.use(express.static(path.join(ROOT, 'public'), noStore));
app.use('/shared', express.static(path.join(ROOT, 'shared'), noStore));
app.use('/scans', express.static(SCANS_DIR)); // .obj files
app.use('/models', express.static(MODELS_DIR)); // .glb files from Meshy

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
    const key = process.env.BODYGRAM_API_KEY;
    const orgId = process.env.BODYGRAM_ORG_ID;
    if (!key || !orgId) return res.json({ ready: false });
    const r = await fetch(`https://platform.bodygram.com/api/orgs/${orgId}/scans?limit=20`, {
      headers: { Authorization: key },
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

// Pull a product from a store link. Zara gets the full live import (chart + photos + composition);
// other stores get a best-effort name/photo. Errors are clear so the UI can offer saved items.
app.post('/api/import', async (req, res) => {
  const url = String(req.body?.url ?? '').trim();
  if (!/^https?:\/\//.test(url)) return res.status(400).json({ error: 'Paste a full product link (https://...)' });
  try {
    if (/(^|\.)zara\.com$/i.test(new URL(url).hostname)) {
      const garment = await importZara(url, {
        garmentsDir: GARMENTS_DIR,
        imgDir: path.join(ROOT, 'public', 'img'),
        log: (m) => console.log('[zara import]', m),
      });
      // A 3D mesh made earlier for this item (public/models/<id>.glb) is linked straight away,
      // so re-importing an item brings its Look back without another upload.
      try {
        await fs.access(path.join(ROOT, 'public', 'models', `${garment.id}.glb`)); // uploaded / Tripo meshes live here
        garment.model = { glb: `/models/${garment.id}.glb`, source: 'existing mesh in public/models', generated: new Date().toISOString().slice(0, 10) };
        await fs.writeFile(path.join(GARMENTS_DIR, `${garment.id}.json`), `${JSON.stringify(garment, null, 2)}\n`);
      } catch { /* no mesh yet: the Add .glb card / Meshy handle it */ }
      return res.json({ imported: true, garment });
    }
    const result = await importProduct(url);
    res.json({ imported: false, ...result });
  } catch (e) {
    console.error('[import]', e.message);
    res.status(502).json({ error: String(e.message) });
  }
});

// ---------- meshy image-to-3D ----------

// Start a Meshy image-to-3D job. Returns { taskId } or { modelUrl, cached: true } if already done.
app.post('/api/meshy', async (req, res) => {
  if (!process.env.MESHY_API_KEY) return res.status(503).json({ error: 'Meshy not configured (add MESHY_API_KEY to .env).' });
  const { garment_id, image_url } = req.body ?? {};
  if (!image_url) return res.status(400).json({ error: 'need image_url' });
  if (garment_id && safeName(garment_id)) {
    try {
      await fs.access(path.join(MODELS_DIR, `${garment_id}.glb`));
      return res.json({ modelUrl: `/models/${garment_id}.glb`, cached: true });
    } catch { /* not cached yet */ }
  }
  try {
    const taskId = await startImageTo3D(image_url);
    res.json({ taskId });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Poll a Meshy task. When done, downloads the GLB locally and returns its URL.
app.get('/api/meshy/:taskId', async (req, res) => {
  if (!process.env.MESHY_API_KEY) return res.status(503).json({ error: 'Meshy not configured.' });
  const { taskId } = req.params;
  const garment_id = req.query.garment_id ?? '';
  try {
    const task = await getMeshyTask(taskId);
    if (task.status === 'FAILED') return res.json({ status: 'FAILED', error: task.task_error?.message ?? 'generation failed' });
    if (task.status !== 'SUCCEEDED') return res.json({ status: task.status, progress: task.progress ?? 0 });
    const glbUrl = task.model_urls?.glb;
    if (!glbUrl) return res.status(502).json({ error: 'No GLB in Meshy result.' });
    let modelUrl = glbUrl;
    if (safeName(garment_id)) {
      await fs.mkdir(MODELS_DIR, { recursive: true });
      const localPath = path.join(MODELS_DIR, `${garment_id}.glb`);
      const buf = await (await fetch(glbUrl)).arrayBuffer();
      await fs.writeFile(localPath, Buffer.from(buf));
      modelUrl = `/models/${garment_id}.glb`;
    }
    res.json({ status: 'SUCCEEDED', modelUrl });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Attach a 3D model (.glb) to a garment: generated e.g. at tripo3d.ai from the product photo,
// uploaded from the phone or laptop. Saved to public/models/<id>.glb and linked in the garment JSON.
// Remove an item from the wardrobe: only its record goes; the mesh (public/models) and photos stay,
// so pasting the link again brings it back complete.
app.delete('/api/garments/:id', async (req, res) => {
  const id = req.params.id;
  if (!safeName(id)) return res.status(400).json({ error: 'bad id' });
  try {
    await fs.unlink(path.join(GARMENTS_DIR, `${id}.json`));
    res.json({ removed: id });
  } catch {
    res.status(404).json({ error: 'item not found' });
  }
});

app.post('/api/garments/:id/model', express.raw({ type: () => true, limit: '80mb' }), async (req, res) => {
  const id = req.params.id;
  const g = await readGarment(id);
  if (!g) return res.status(404).json({ error: 'garment not found' });
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || buf.length < 100) return res.status(400).json({ error: 'no file received' });
  if (buf.readUInt32LE(0) !== 0x46546c67) return res.status(400).json({ error: 'not a .glb file (binary glTF)' });
  const modelsDir = path.join(ROOT, 'public', 'models');
  await fs.mkdir(modelsDir, { recursive: true });
  const file = `${id}.glb`;
  await fs.writeFile(path.join(modelsDir, file), buf);
  g.model = { glb: `/models/${file}`, source: 'uploaded via app', generated: new Date().toISOString().slice(0, 10) };
  await fs.writeFile(path.join(GARMENTS_DIR, `${id}.json`), JSON.stringify(g, null, 2) + '\n');
  res.json({ garment: g });
});

// ---------- fit ----------
app.post('/api/fit', async (req, res) => {
  const { scan, measurements_cm, garment_id, garment } = req.body ?? {};
  let body = measurements_cm;
  if (!body && scan) {
    body = (await readScan(scan))?.measurements_cm;
    if (!body) return res.status(404).json({ error: `saved body "${scan}" not found — reload and pick a body again` });
  }
  if (!body) return res.status(400).json({ error: 'need scan name or measurements_cm' });
  const g = garment ?? (await readGarment(garment_id));
  if (!g) return res.status(404).json({ error: 'garment not found' });
  try {
    const opts = { waistOffsetCm: Math.max(-12, Math.min(6, Number(req.body?.waist_offset_cm ?? 0) || 0)) };
    res.json({ report: fitReport(body, g, opts), body_cm: body, landmarks_cm: bodyLandmarks(body) });
  } catch (e) {
    res.status(400).json({ error: String(e.message) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`3D Clothes Scanner running at http://localhost:${PORT}`));
