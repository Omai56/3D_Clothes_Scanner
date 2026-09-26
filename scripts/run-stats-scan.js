// Run ONE stats-only Bodygram scan and save the result to data/scans/.
// Each run consumes 1 of the 5 free scans. Saved results are reused by the app,
// so only run this when you really need a new body.
//
// Usage:
//   node scripts/run-stats-scan.js --name demo --height 175 --weight 70 --age 22 --gender male
//
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createStatsScan } from '../server/bodygram.js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1]] : null)).filter(Boolean),
);

const name = args.name ?? 'demo';
const heightCm = Number(args.height);
const weightKg = Number(args.weight);
const age = Number(args.age);
const gender = args.gender;

if (!heightCm || !weightKg || !age || !['male', 'female'].includes(gender)) {
  console.error('Usage: node scripts/run-stats-scan.js --name demo --height <cm> --weight <kg> --age <years> --gender male|female');
  process.exit(1);
}

const outDir = path.resolve('data/scans');
const jsonPath = path.join(outDir, `${name}.json`);
const objPath = path.join(outDir, `${name}.obj`);

try {
  await fs.access(jsonPath);
  console.error(`Refusing to overwrite ${jsonPath}. Pick another --name or delete the file first.`);
  process.exit(1);
} catch {
  /* does not exist – good */
}

console.log(`Requesting stats-only scan: ${heightCm} cm, ${weightKg} kg, ${age} y, ${gender} ...`);
const entry = await createStatsScan({ heightCm, weightKg, age, gender, customScanId: name });

if (entry.status !== 'success') {
  console.error('Scan failed:', JSON.stringify(entry.error ?? entry, null, 2));
  process.exit(1);
}

await fs.mkdir(outDir, { recursive: true });
// Save the OBJ as a plain file and keep the JSON small (no base64 blob).
const obj = Buffer.from(entry.avatar.data, 'base64').toString('utf8');
await fs.writeFile(objPath, obj);
const { avatar, ...rest } = entry;
await fs.writeFile(
  jsonPath,
  JSON.stringify({ ...rest, avatarFile: path.basename(objPath), input: { heightCm, weightKg, age, gender } }, null, 2),
);

console.log(`Saved ${jsonPath} (${entry.measurements.length} measurements) and ${objPath} (${(obj.length / 1024).toFixed(0)} KB)`);
