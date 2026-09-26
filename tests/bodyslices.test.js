import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRings, ringAt, ringCircumference, parseObj, armLine } from '../shared/bodyslices.js';
import { measurementsToCm } from '../server/bodygram.js';

const scan = JSON.parse(fs.readFileSync(new URL('../data/scans/demo.json', import.meta.url)));
const body = measurementsToCm(scan.measurements);
const obj = fs.readFileSync(new URL('../data/scans/demo.obj', import.meta.url), 'utf8');
const { positions, faces } = parseObj(obj);
const t0 = performance.now();
const rings = buildRings(positions, faces, {
  crotchY: body.insideLegHeight / 100,
  shoulderHalfWidth: body.acrossBackShoulderWidth / 200,
  neckY: body.backNeckHeight / 100,
});
const buildMs = performance.now() - t0;
console.log(`buildRings: ${buildMs.toFixed(0)} ms, armpit at ${(rings.armpitY * 100).toFixed(0)} cm, torso half-width there ${(rings.torsoHalfAtArmpit * 100).toFixed(1)} cm`);

test('parses all vertices and faces', () => {
  assert.equal(positions.length / 3, 32078);
  assert.equal(faces.length / 3, 32076 * 2); // quads -> 2 triangles each
});

test('ring build is fast enough for a phone', () => {
  assert.ok(buildMs < 1500, `took ${buildMs.toFixed(0)} ms`);
});

// The torso outline circumference should match Bodygram's own girth closely.
// If arms leaked into the torso outline this would blow up.
// Bust: Bodygram's bust height is above the armpit on this avatar, where the arm roots are
// fused into the torso outline; we clip them but the section still runs through the shoulder
// mass, so allow a wider tolerance there.
for (const [label, hKey, gKey, tol] of [
  ['bust', 'bustHeight', 'bustGirth', 0.18],
  ['waist', 'waistHeight', 'waistGirth', 0.08],
  ['hip', 'hipHeight', 'hipGirth', 0.08],
]) {
  test(`torso ring at ${label} height matches ${gKey}`, () => {
    const ring = ringAt(rings.torso, body[hKey] / 100);
    assert.ok(ring, `no ring at ${label}`);
    const circ = ringCircumference(ring) * 100;
    const err = Math.abs(circ - body[gKey]) / body[gKey];
    assert.ok(err < tol, `${label}: ring ${circ.toFixed(1)} cm vs measured ${body[gKey]} cm (${(err * 100).toFixed(0)}%)`);
  });
}

test('leg ring at mid-thigh roughly matches thigh girth', () => {
  const y = (body.insideLegHeight + body.kneeHeightR) / 2 / 100;
  const ring = ringAt(rings.right, y);
  assert.ok(ring);
  const circ = ringCircumference(ring) * 100;
  assert.ok(Math.abs(circ - body.midThighGirthR) / body.midThighGirthR < 0.15, `thigh ring ${circ.toFixed(1)} vs ${body.midThighGirthR}`);
});

test('both legs found, mirrored around x=0', () => {
  const y = body.kneeHeightR / 100;
  const r = ringAt(rings.right, y);
  const l = ringAt(rings.left, y);
  assert.ok(r && l);
  assert.ok(r.cx > 0.03 && l.cx < -0.03, `leg centres ${r.cx} ${l.cx}`);
});

test('arm line found, runs from the armpit down to the hand', () => {
  const arm = armLine(rings.armR);
  assert.ok(arm, `armR slices: ${rings.armR.length}`);
  assert.ok(arm.shoulder.y > 1.1 && arm.shoulder.y < 1.5, `top y ${arm.shoulder.y}`);
  // arm loops are only tracked down to the crotch height, so the "hand" is where the arm passes the crotch
  assert.ok(arm.hand.y < arm.shoulder.y - 0.3, `hand y ${arm.hand.y}`);
  assert.ok(arm.shoulder.x > 0.15);
  const armL = armLine(rings.armL);
  assert.ok(armL && armL.shoulder.x < -0.15);
});

test('armpit is below the bust height and torso is narrower than the shoulders there', () => {
  assert.ok(rings.armpitY < body.bustHeight / 100 + 0.02);
  assert.ok(rings.torsoHalfAtArmpit < body.acrossBackShoulderWidth / 200);
  assert.ok(rings.torsoHalfAtArmpit > 0.12);
});
