// Thin wrapper around the Bodygram Platform API.
// Docs: https://docs.bodygram.com/platform/endpoints
// The API key must stay server-side. The ORG_ID is safe to expose.

const BASE = 'https://platform.bodygram.com';

function env(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env`);
  return v;
}

async function bodygramFetch(pathname, init = {}) {
  const res = await fetch(`${BASE}/api/orgs/${env('BODYGRAM_ORG_ID')}${pathname}`, {
    ...init,
    headers: {
      Authorization: env('BODYGRAM_API_KEY'), // raw key, no "Bearer"
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Bodygram ${init.method ?? 'GET'} ${pathname} -> HTTP ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** Stats-only scan (no photos). Consumes 1 scan of quota. Returns the `entry` object. */
export async function createStatsScan({ heightCm, weightKg, age, gender, customScanId }) {
  const body = {
    statsEstimations: {
      age: Math.round(age),
      gender,
      height: Math.round(heightCm * 10), // mm
      weight: Math.round(weightKg * 1000), // g
    },
  };
  if (customScanId) body.customScanId = customScanId;
  const { entry } = await bodygramFetch('/scans', { method: 'POST', body: JSON.stringify(body) });
  return entry;
}

/** Fetch a finished scan by id (does not consume quota). */
export async function getScan(scanId) {
  const { entry } = await bodygramFetch(`/scans/${encodeURIComponent(scanId)}`);
  return entry;
}

/** Issue a single-use token for the hosted phone scanner. */
export async function createScanToken({ customScanId, lifetimeSeconds = 3600 } = {}) {
  const body = {
    scope: ['api.platform.bodygram.com/scans:create', 'api.platform.bodygram.com/scans:read'],
    lifetime: lifetimeSeconds,
  };
  if (customScanId) body.customScanId = customScanId;
  return bodygramFetch('/scan-tokens', { method: 'POST', body: JSON.stringify(body) });
}

/** URL of Bodygram's hosted scanner page for the phone. */
export function scannerUrl({ token, locale = 'en', prefill = {} }) {
  const params = new URLSearchParams({ token, system: 'metric', 'scanflow-v2': 'true', tap: 'true' });
  for (const k of ['height', 'weight', 'age', 'gender']) if (prefill[k] != null) params.set(k, String(prefill[k]));
  return `${BASE}/${locale}/${env('BODYGRAM_ORG_ID')}/scan?${params}`;
}

/** Turn Bodygram's measurements array into a {name: cm} map. */
export function measurementsToCm(measurements) {
  const out = {};
  for (const m of measurements ?? []) out[m.name] = m.unit === 'mm' ? m.value / 10 : m.value;
  return out;
}
