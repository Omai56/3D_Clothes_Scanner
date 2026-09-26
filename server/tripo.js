// Tripo3D image-to-3D: turn a product photo into a textured GLB mesh.
// API shape from Tripo's official SDK: base https://api.tripo3d.ai/v2/openapi, Bearer tsk_… key.
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://api.tripo3d.ai/v2/openapi';

function key() {
  const k = process.env.TRIPO_API_KEY;
  if (!k) throw new Error('Missing TRIPO_API_KEY in .env');
  return k;
}

async function api(pathname, init = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { Authorization: `Bearer ${key()}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Tripo ${pathname}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
  if (!res.ok || (json.code && json.code !== 0)) {
    throw new Error(`Tripo ${pathname}: HTTP ${res.status} code ${json.code} ${json.message ?? ''} ${json.suggestion ?? ''}`.trim());
  }
  return json.data ?? json;
}

export async function balance() {
  return api('/user/balance');
}

/** Upload a local image; returns the file token. */
export async function uploadImage(filePath) {
  const buf = await fs.readFile(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase() || 'jpg';
  const form = new FormData();
  form.append('file', new Blob([buf], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` }), path.basename(filePath));
  const data = await api('/upload', { method: 'POST', body: form });
  return { token: data.image_token ?? data.file_token, type: ext === 'jpeg' ? 'jpg' : ext };
}

/** Create an image_to_model task from an uploaded token or a public URL. */
export async function createImageToModel({ token, type = 'jpg', url, options = {} }) {
  const file = { type };
  if (token) file.file_token = token;
  else if (url) file.url = url;
  else throw new Error('need token or url');
  const body = { type: 'image_to_model', file, texture: true, pbr: true, ...options };
  const data = await api('/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return data.task_id;
}

export async function getTask(taskId) {
  return api(`/task/${taskId}`);
}

/** Poll until the task finishes. onProgress(status, progress). */
export async function waitForTask(taskId, { intervalMs = 3000, timeoutMs = 10 * 60 * 1000, onProgress = () => {} } = {}) {
  const t0 = Date.now();
  for (;;) {
    const t = await getTask(taskId);
    onProgress(t.status, t.progress, t);
    if (t.status === 'success') return t;
    if (['failed', 'cancelled', 'banned', 'expired', 'unknown'].includes(t.status)) throw new Error(`Tripo task ${t.status}: ${t.error_msg ?? t.error_code ?? ''}`);
    if (Date.now() - t0 > timeoutMs) throw new Error('Tripo task timed out');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

/**
 * Photo -> GLB on disk. Returns { glbPath, previewPath, task }.
 */
export async function photoToGlb(imagePath, outBase, { log = () => {}, options } = {}) {
  log('uploading photo…');
  const { token, type } = await uploadImage(imagePath);
  log('creating image_to_model task…');
  const taskId = await createImageToModel({ token, type, options });
  log(`task ${taskId}`);
  const task = await waitForTask(taskId, { onProgress: (s, p) => log(`${s} ${p ?? ''}%`) });
  const out = task.output ?? {};
  const modelUrl = out.pbr_model || out.model || out.base_model;
  if (!modelUrl) throw new Error('task succeeded but no model URL in output');
  const glbPath = await download(modelUrl, `${outBase}.glb`);
  let previewPath = null;
  if (out.rendered_image) {
    try {
      previewPath = await download(out.rendered_image, `${outBase}.webp`);
    } catch {
      /* optional */
    }
  }
  return { glbPath, previewPath, task };
}
