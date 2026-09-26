// Download an existing Bodygram scan (by id) into data/scans/<name>.json + .obj.
// Does NOT use scan quota — it only fetches a scan that already exists.
//
// Usage:
//   node scripts/save-scan.js <scan_id> <name>
//   node scripts/save-scan.js --latest <name>      (newest successful scan in the account)
//
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getScan, saveScanFiles } from '../server/bodygram.js';

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error('Usage: node scripts/save-scan.js <scan_id | --latest> <name>');
  process.exit(1);
}
const name = b;
if (!/^[\w-]{1,64}$/.test(name)) {
  console.error('name must be letters/digits/-/_ only');
  process.exit(1);
}

let scanId = a;
if (a === '--latest') {
  const r = await fetch(`https://platform.bodygram.com/api/orgs/${process.env.BODYGRAM_ORG_ID}/scans?limit=20`, {
    headers: { Authorization: process.env.BODYGRAM_API_KEY },
  });
  const { results = [] } = await r.json();
  const hit = results.find((s) => s.status === 'success');
  if (!hit) {
    console.error('No successful scans in the account.');
    process.exit(1);
  }
  scanId = hit.id;
}

const outDir = path.resolve('data/scans');
const jsonPath = path.join(outDir, `${name}.json`);
const objPath = path.join(outDir, `${name}.obj`);
try {
  await fs.access(jsonPath);
  console.error(`Refusing to overwrite ${jsonPath}. Pick another name or delete it first.`);
  process.exit(1);
} catch {
  /* ok */
}

console.log(`Fetching ${scanId} ...`);
const entry = await getScan(scanId);
if (entry.status !== 'success') {
  console.error('Scan is not successful:', JSON.stringify(entry.error ?? entry, null, 2));
  process.exit(1);
}
const { objBytes, measurements } = await saveScanFiles(outDir, name, entry);
console.log(`Saved ${jsonPath} (${measurements} measurements) and ${objPath} (${(objBytes / 1024).toFixed(0)} KB)`);
