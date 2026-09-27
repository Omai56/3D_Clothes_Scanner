// Generate a 3D mesh of a garment from its product photo with Tripo3D.
//
// Usage:
//   node scripts/tripo-mesh.js --balance
//   node scripts/tripo-mesh.js <garment-id> [--image N] [--version v2.5-20250123]
//
// Output: public/models/<garment-id>.glb (+ .webp preview) and `model` field written into the garment JSON.
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { balance, photoToGlb } from '../server/tripo.js';

const argv = process.argv.slice(2);
if (argv.includes('--balance')) {
  console.log(await balance());
  process.exit(0);
}
const id = argv.find((a) => !a.startsWith('--'));
if (!id) {
  console.error('Usage: node scripts/tripo-mesh.js <garment-id> [--image N] [--version …] | --balance');
  process.exit(1);
}
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const imageIndex = Number(opt('--image', '1')) - 1;
const version = opt('--version', null);

const gPath = path.resolve('data/garments', `${id}.json`);
const g = JSON.parse(await fs.readFile(gPath, 'utf8'));
const img = g.images?.[imageIndex];
if (!img) {
  console.error('garment has no image at index', imageIndex + 1);
  process.exit(1);
}
const imagePath = path.resolve('public', img.replace(/^\//, ''));
console.log('balance before:', await balance());
const t0 = Date.now();
const { glbPath, previewPath, task } = await photoToGlb(imagePath, path.resolve('public/models', id), {
  log: (m) => console.log(`[tripo] ${m}`),
  options: version ? { model_version: version } : {},
});
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${glbPath}${previewPath ? ' + ' + previewPath : ''}`);
console.log('balance after:', await balance());
g.model = { glb: `/models/${path.basename(glbPath)}`, preview: previewPath ? `/models/${path.basename(previewPath)}` : null, source: 'tripo3d image_to_model', task_id: task.task_id, from_image: img };
await fs.writeFile(gPath, JSON.stringify(g, null, 2) + '\n');
console.log('wrote model info into', gPath);
