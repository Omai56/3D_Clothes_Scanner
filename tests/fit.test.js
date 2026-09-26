import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fitReport, evaluateSize, girthAtHeight } from '../shared/fit.js';
import { measurementsToCm } from '../server/bodygram.js';

const scan = JSON.parse(fs.readFileSync(new URL('../data/scans/demo.json', import.meta.url)));
const body = measurementsToCm(scan.measurements);
const load = (id) => JSON.parse(fs.readFileSync(new URL(`../data/garments/${id}.json`, import.meta.url)));

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
  for (const id of ['zara-heavyweight-tee', 'zara-oversized-hoodie', 'zara-slim-jeans']) {
    const g = load(id);
    const report = fitReport(body, g);
    const order = report.size_order;
    for (let i = 1; i < order.length; i++) {
      const prev = report.sizes[order[i - 1]].regions;
      const cur = report.sizes[order[i]].regions;
      for (const key of Object.keys(cur)) {
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

test('jeans: 78 cm waist body vs 30 (78 cm) is snug, 36 (93 cm) is very loose', () => {
  const report = fitReport(body, load('zara-slim-jeans'));
  assert.equal(report.sizes['30'].regions.waist.verdict, 'snug');
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
