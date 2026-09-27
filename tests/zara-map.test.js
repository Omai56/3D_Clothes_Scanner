import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mapZaraChart, mapLabel, compositionText, stretchFromComposition, buildGarment } from '../server/zara-map.js';

const guide = JSON.parse(fs.readFileSync(new URL('./fixtures/zara-size-measure-guide-tee.json', import.meta.url)));

test('maps Zara table titles, including their machine-translated rise labels', () => {
  assert.equal(mapLabel('CHEST'), 'chest');
  assert.equal(mapLabel('FRONT LENGTH'), 'length');
  assert.equal(mapLabel('WIDE BACK'), 'shoulder');
  assert.equal(mapLabel('ARM WIDTH'), 'arm_width');
  assert.equal(mapLabel('Front tow hook'), 'rise');
  assert.equal(mapLabel('Backfire'), 'back_rise');
  assert.equal(mapLabel('TOTAL LENGTH'), 'total_length');
  assert.equal(mapLabel('SOMETHING ELSE'), null);
});

test('real size-measure-guide fixture maps to a 5-size top chart in cm', () => {
  const chart = mapZaraChart(guide);
  assert.equal(chart.category, 'top');
  assert.deepEqual(Object.keys(chart.sizes), ['S', 'M', 'L', 'XL', 'XXL']);
  assert.deepEqual(chart.sizes.S, { chest: 56, length: 66, sleeve: 22, shoulder: 55.5, arm_width: 20 });
  assert.equal(chart.unmapped.length, 0);
});

test('composition and stretch', () => {
  const dc = { parts: [{ description: 'OUTER SHELL', components: [{ material: 'cotton', percentage: '95%' }, { material: 'elastane', percentage: '5%' }] }] };
  assert.equal(compositionText(dc), '95% cotton, 5% elastane');
  assert.equal(stretchFromComposition('95% cotton, 5% elastane'), 'high');
  assert.equal(stretchFromComposition('98% cotton, 2% elastane'), 'medium');
  assert.equal(stretchFromComposition('100% cotton', { denim: true }), 'none');
  assert.equal(stretchFromComposition('100% cotton'), 'low');
});

test('buildGarment produces a valid top with sleeve type and id', () => {
  const g = buildGarment({ url: 'https://www.zara.com/ca/en/x-p1.html?v1=545422590', productId: 545422590, name: 'BASIC HEAVYWEIGHT T-SHIRT /03', familyName: 'T-SHIRT', composition: '100% cotton', chart: mapZaraChart(guide), price: 3290, currency: 'CA$' });
  assert.equal(g.id, 'zara-basic-heavyweight-t-shirt-03-545422590');
  assert.equal(g.category, 'top');
  assert.equal(g.sleeve_type, 'short');
  assert.equal(g.price, 'CA$32.90');
  assert.equal(g.chart_type, 'garment_flat');
  assert.equal(g.sizes.M.chest, 58);
});

test('bottoms detection from chart shape', () => {
  const chart = { sizes: { 28: { waist: 35, hip: 49, total_length: 106, rise: 31 } }, unmapped: [], category: 'bottom' };
  const g = buildGarment({ url: 'u', productId: 1, name: 'LOOSE FIT JEANS', familyName: 'JEANS', composition: '100% cotton', chart });
  assert.equal(g.category, 'bottom');
  assert.equal(g.stretch, 'none');
  assert.equal(g.sleeve_type, undefined);
});
