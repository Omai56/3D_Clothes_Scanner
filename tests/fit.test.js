import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fitReport, evaluateSize, girthAtHeight } from '../shared/fit.js';
import { measurementsToCm } from '../server/bodygram.js';

const scan = JSON.parse(fs.readFileSync(new URL('../data/scans/demo.json', import.meta.url)));
const body = measurementsToCm(scan.measurements);
const load = (id) => {
  for (const dir of ['../data/garments/', '../data/garments/examples/']) {
    try {
      return JSON.parse(fs.readFileSync(new URL(`${dir}${id}.json`, import.meta.url)));
    } catch {
      /* try next */
    }
  }
  throw new Error(`garment ${id} not found`);
};

test('demo body has the measurements the fit engine needs', () => {
  for (const k of ['bustGirth', 'waistGirth', 'hipGirth', 'acrossBackShoulderWidth', 'backNeckHeight', 'insideLegHeight', 'thighGirthR'])
    assert.ok(body[k] > 0, `missing ${k}`);
  assert.ok(Math.abs(body.bustGirth - 91.4) < 0.2);
});

test('flat chart widths are doubled before comparing to body girths', () => {
  const tee = load('zara-heavyweight-tee');
  const m = evaluateSize(body, tee, 'M');
  assert.equal(m.regions.chest.garment_cm, Math.round(tee.sizes.M.chest * 2 * 10) / 10);
  assert.equal(m.regions.chest.body_cm, 91.4);
  assert.equal(m.regions.chest.ease_cm, Math.round((tee.sizes.M.chest * 2 - 91.4) * 10) / 10);
});

test('real Zara heavyweight tee: dropped shoulders are not reported as loose; upper arm is checked', () => {
  const tee = load('zara-heavyweight-tee');
  const s = evaluateSize(body, tee, 'S');
  assert.equal(s.regions.shoulder.verdict, 'good');
  assert.match(s.regions.shoulder.label, /dropped/i);
  assert.ok(s.regions.arm, 'upper arm region missing');
  assert.equal(s.regions.arm.garment_cm, Math.round(tee.sizes.S.arm_width * 2 * 10) / 10);
});

test('bigger sizes are never tighter than smaller ones', () => {
  for (const id of ['zara-heavyweight-tee', 'zara-slim-tee', 'zara-loose-jeans', 'zara-oversized-hoodie', 'zara-slim-jeans']) {
    const g = load(id);
    const report = fitReport(body, g);
    const order = report.size_order;
    for (let i = 1; i < order.length; i++) {
      const prev = report.sizes[order[i - 1]].regions;
      const cur = report.sizes[order[i]].regions;
      for (const key of Object.keys(cur)) {
        if (['inseam', 'length', 'sleeve'].includes(key)) continue; // lengths aren't "tightness" and derived inseams can shrink
        if (cur[key].ease_cm == null || prev[key]?.ease_cm == null) continue;
        assert.ok(cur[key].ease_cm >= prev[key].ease_cm, `${id} ${key}: ${order[i]} tighter than ${order[i - 1]}`);
      }
    }
  }
});

test('t-shirt recommendation is a sensible size for a 91 cm chest', () => {
  const report = fitReport(body, load('zara-heavyweight-tee'));
  assert.ok(['S', 'M'].includes(report.recommended), `got ${report.recommended}`);
  assert.equal(report.sizes.XL.regions.chest.verdict, 'very_loose');
  assert.match(report.sizes[report.recommended].summary, /Hem lands/);
});

test('real Zara loose jeans: inseam derived from total length - rise; waistband compared at its own height', () => {
  const jeans = load('zara-loose-jeans');
  const r = fitReport(body, jeans);
  const s30 = r.sizes['30'];
  assert.ok(s30.regions.inseam, 'inseam region missing');
  assert.equal(s30.regions.inseam.garment_cm, Math.round((107.4 - 33 + 1) * 10) / 10);
  assert.ok(s30.regions.waist.height_cm <= body.waistHeight + 0.01);
  assert.ok(!s30.regions.thigh, 'no thigh data in this chart');
  // demo body waist 77.9: 30 (78.2) snug, 36 (94) very loose
  assert.equal(r.sizes['36'].regions.waist.verdict, 'very_loose');
  assert.ok(['29', '30', '31'].includes(r.recommended), `got ${r.recommended}`);
  assert.match(s30.summary, /Waistband sits/);
});

test('real Zara slim tee (95/5 elastane): stretch allowance, shoulders not flagged as dropped', () => {
  const tee = load('zara-slim-tee');
  const r = fitReport(body, tee);
  for (const s of Object.values(r.sizes)) assert.doesNotMatch(s.regions.shoulder.label, /dropped/i);
  // demo chest 91.4: M is 93 cm (1.6 cm ease) -> good on high-stretch fabric; XXL 116.8 -> loose or very loose
  assert.equal(r.sizes.M.regions.chest.verdict, 'good');
  assert.ok(['loose', 'very_loose'].includes(r.sizes.XXL.regions.chest.verdict));
  assert.ok(['M', 'L'].includes(r.recommended), `got ${r.recommended}`);
});

test('example jeans: 78 cm waist body vs 30 (78 cm) is tight/snug, 36 (93 cm) is very loose', () => {
  const report = fitReport(body, load('zara-slim-jeans'));
  assert.ok(['tight', 'snug'].includes(report.sizes['30'].regions.waist.verdict));
  assert.equal(report.sizes['36'].regions.waist.verdict, 'very_loose');
  assert.ok(['30', '32'].includes(report.recommended), `got ${report.recommended}`);
});

test('oversized hoodie reads as relaxed/loose in every size, never tight', () => {
  const report = fitReport(body, load('zara-oversized-hoodie'));
  for (const s of Object.values(report.sizes)) {
    assert.notEqual(s.regions.chest.verdict, 'tight');
    assert.notEqual(s.regions.shoulder.verdict, 'tight');
  }
});

test('girthAtHeight interpolates between waist and hip', () => {
  const mid = (body.waistHeight + body.hipHeight) / 2;
  const g = girthAtHeight(body, mid);
  assert.ok(g > Math.min(body.waistGirth, body.hipGirth) && g < Math.max(body.waistGirth, body.hipGirth));
  assert.equal(girthAtHeight(body, 200), body.bustGirth);
  assert.equal(girthAtHeight(body, 0), body.hipGirth);
});
