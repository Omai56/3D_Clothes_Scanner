// Slices the body mesh into horizontal rings so the 3D viewer can build a garment
// "shell" around the body at any height. Pure JS (works in Node for tests and in the browser).
//
// Method: intersect every triangle with the 1 cm slice planes, chain the resulting segments
// into closed outline loops (torso, each arm, each leg are separate loops because they are
// separate surfaces on the avatar), then convert each loop into N radii around its centroid.
//
// Input: OBJ vertex positions in metres (y-up, feet at y≈0) + triangle indices.

export const RING_BINS = 64;
export const SLICE_STEP = 0.01; // metres

/**
 * @param positions Float32Array xyz in metres
 * @param faces     Uint32Array triangle indices
 * @param opts      { crotchY, shoulderHalfWidth, neckY } metres
 */
export function buildRings(positions, faces, { crotchY, shoulderHalfWidth = 0.23, neckY = 1.5 }) {
  const loopsBySlice = crossSections(positions, faces);
  const shoulderY = neckY - 0.06;

  const torso = new Map();
  const right = new Map();
  const left = new Map();
  const armR = [];
  const armL = [];

  // Pass 1: classify loops per slice, find the armpit (highest slice where the arms are
  // still separate loops) and the torso half-width there.
  const classified = new Map();
  let armpitIy = -1;
  let torsoHalfAtArmpit = shoulderHalfWidth * 0.75;
  let torsoCx = 0; // the torso's own centre line (bodies are not centred on x = 0)
  for (const [iy, loops] of loopsBySlice) {
    const y = iy * SLICE_STEP;
    if (!loops.length || y < crotchY) continue;
    loops.sort((a, b) => b.area - a.area);
    const main = loops[0];
    const arms = [];
    for (const lp of loops.slice(1)) {
      if (lp.area < 5e-4) continue;
      if (lp.cx > main.maxX - 0.01 || lp.cx < main.minX + 0.01) arms.push(lp);
    }
    classified.set(iy, { main, arms });
    if (arms.length && iy > armpitIy) armpitIy = iy;
  }
  const armpitY = armpitIy * SLICE_STEP;
  // Torso width just below the armpit (a few cm down, where the outline is clean of the arm root).
  for (let d = 3; d <= 6; d++) {
    const c = classified.get(armpitIy - d);
    if (c) {
      torsoHalfAtArmpit = (c.main.maxX - c.main.minX) / 2;
      torsoCx = (c.main.maxX + c.main.minX) / 2;
      break;
    }
  }

  // Above the armpit the arms are fused into the torso outline. Clip the outline to the
  // torso width, widening linearly from the armpit width to the shoulder width.
  function torsoBound(y) {
    if (y <= armpitY) return Infinity;
    const t = Math.min(1, (y - armpitY) / Math.max(0.01, shoulderY - armpitY));
    return torsoHalfAtArmpit + (shoulderHalfWidth - torsoHalfAtArmpit) * t;
  }

  // Pass 2: build rings.
  // Legs are "two separate loops near the centre line, one each side". Just below the
  // measured crotch height the legs are often still one fused outline; those slices count
  // as torso so the shell has no hole. Hands hanging beside the legs (|x| > 0.2) are ignored.
  let crotchSplitY = crotchY;
  for (const [iy, loops] of loopsBySlice) {
    const y = iy * SLICE_STEP;
    if (!loops.length) continue;
    if (y < crotchY + 0.06) {
      const legs = loops.filter((l) => l.area > 1e-4 && Math.abs(l.cx) < 0.2 && !(l.minX < -0.02 && l.maxX > 0.02));
      const r = legs.find((l) => l.cx >= 0);
      const l = legs.find((l) => l.cx < 0);
      if (r && l) {
        right.set(iy, ringFromLoop(r, y));
        left.set(iy, ringFromLoop(l, y));
        continue;
      }
      if (y < crotchY) {
        // fused: treat as torso
        const main = loops.slice().sort((a, b) => b.area - a.area)[0];
        torso.set(iy, ringFromLoop(main, y));
        if (y < crotchSplitY) crotchSplitY = y;
        continue;
      }
    }
    const c = classified.get(iy);
    if (!c) continue;
    const { main, arms } = c;
    const bound = torsoBound(y);
    const loop = Number.isFinite(bound) ? clipLoopX(main, bound, torsoCx) : main;
    torso.set(iy, ringFromLoop(loop, y));
    for (const lp of arms) (lp.cx > 0 ? armR : armL).push({ x: lp.cx, y, z: lp.cz, area: lp.area });
  }
  // Highest slice where both legs exist = where the leg shells should start.
  let legTopY = 0;
  for (const k of right.keys()) if (left.has(k)) legTopY = Math.max(legTopY, k * SLICE_STEP);

  smoothAcrossSlices(torso);
  smoothAcrossSlices(right);
  smoothAcrossSlices(left);
  armR.sort((a, b) => a.y - b.y);
  armL.sort((a, b) => a.y - b.y);
  return { torso, right, left, armR, armL, armpitY, torsoHalfAtArmpit, torsoCx, crotchSplitY, legTopY };
}

/** Clamp a loop's x to ±bound (flattens fused arms into vertical torso sides). */
function clipLoopX(loop, bound, cx = 0) {
  const pts = Float64Array.from(loop.pts);
  for (let i = 0; i < pts.length; i += 2) pts[i] = Math.max(cx - bound, Math.min(cx + bound, pts[i]));
  return loopStats(Array.from(pts));
}

/** For each slice index, the closed outline loops of the mesh at that height. */
function crossSections(positions, faces) {
  const perSlice = new Map(); // iy -> Map(edgeKey -> {x,z,nbrs:[]})
  const nTri = faces.length / 3;
  const key = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);

  for (let t = 0; t < nTri; t++) {
    const ia = faces[t * 3];
    const ib = faces[t * 3 + 1];
    const ic = faces[t * 3 + 2];
    const ya = positions[ia * 3 + 1];
    const yb = positions[ib * 3 + 1];
    const yc = positions[ic * 3 + 1];
    const ymin = Math.min(ya, yb, yc);
    const ymax = Math.max(ya, yb, yc);
    const i0 = Math.ceil(ymin / SLICE_STEP);
    const i1 = Math.floor(ymax / SLICE_STEP);
    for (let iy = i0; iy <= i1; iy++) {
      const y = iy * SLICE_STEP;
      const hits = [];
      for (const [p, q, yp, yq] of [
        [ia, ib, ya, yb],
        [ib, ic, yb, yc],
        [ic, ia, yc, ya],
      ]) {
        if (yp < y === yq < y) continue; // no crossing (half-open rule handles vertices on the plane)
        const s = (y - yp) / (yq - yp);
        hits.push({
          k: key(p, q),
          x: positions[p * 3] + (positions[q * 3] - positions[p * 3]) * s,
          z: positions[p * 3 + 2] + (positions[q * 3 + 2] - positions[p * 3 + 2]) * s,
        });
      }
      if (hits.length !== 2) continue;
      let m = perSlice.get(iy);
      if (!m) perSlice.set(iy, (m = new Map()));
      for (const h of hits) if (!m.has(h.k)) m.set(h.k, { x: h.x, z: h.z, nbrs: [] });
      m.get(hits[0].k).nbrs.push(hits[1].k);
      m.get(hits[1].k).nbrs.push(hits[0].k);
    }
  }

  const out = new Map();
  for (const [iy, m] of perSlice) {
    const loops = [];
    const seen = new Set();
    for (const startKey of m.keys()) {
      if (seen.has(startKey)) continue;
      const pts = [];
      let prev = null;
      let cur = startKey;
      while (cur != null && !seen.has(cur)) {
        seen.add(cur);
        const node = m.get(cur);
        pts.push(node.x, node.z);
        const next = node.nbrs.find((k) => k !== prev && !seen.has(k));
        prev = cur;
        cur = next;
      }
      if (pts.length >= 6) loops.push(loopStats(pts));
    }
    out.set(iy, loops);
  }
  return out;
}

function loopStats(pts) {
  const n = pts.length / 2;
  let area = 0;
  let cx = 0;
  let cz = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < n; i++) {
    const x0 = pts[i * 2];
    const z0 = pts[i * 2 + 1];
    const x1 = pts[((i + 1) % n) * 2];
    const z1 = pts[((i + 1) % n) * 2 + 1];
    const cross = x0 * z1 - x1 * z0;
    area += cross;
    cx += (x0 + x1) * cross;
    cz += (z0 + z1) * cross;
    if (x0 < minX) minX = x0;
    if (x0 > maxX) maxX = x0;
  }
  area /= 2;
  if (Math.abs(area) < 1e-9) {
    // degenerate: fall back to vertex mean
    let sx = 0;
    let sz = 0;
    for (let i = 0; i < n; i++) {
      sx += pts[i * 2];
      sz += pts[i * 2 + 1];
    }
    return { pts, area: 0, cx: sx / n, cz: sz / n, minX, maxX };
  }
  return { pts, area: Math.abs(area), cx: cx / (6 * area), cz: cz / (6 * area), minX, maxX };
}

function ringFromLoop(loop, y) {
  const { pts, cx, cz } = loop;
  const r = new Float32Array(RING_BINS).fill(-1);
  const n = pts.length / 2;
  // Sample each polygon edge every ~4 mm so every angular bin gets hit.
  for (let i = 0; i < n; i++) {
    const x0 = pts[i * 2];
    const z0 = pts[i * 2 + 1];
    const x1 = pts[((i + 1) % n) * 2];
    const z1 = pts[((i + 1) % n) * 2 + 1];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.004));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const dx = x0 + (x1 - x0) * t - cx;
      const dz = z0 + (z1 - z0) * t - cz;
      const ang = Math.atan2(dz, dx);
      const bin = ((Math.round(((ang + Math.PI) / (2 * Math.PI)) * RING_BINS) % RING_BINS) + RING_BINS) % RING_BINS;
      const d = Math.hypot(dx, dz);
      if (d > r[bin]) r[bin] = d;
    }
  }
  fillGaps(r);
  return { y, cx, cz, r };
}

// Fill bins that got no samples by interpolating around the ring.
function fillGaps(r) {
  const N = r.length;
  let known = 0;
  for (let i = 0; i < N; i++) if (r[i] >= 0) known++;
  if (known === 0 || known === N) return;
  for (let i = 0; i < N; i++) {
    if (r[i] >= 0) continue;
    let a = i;
    let b = i;
    let da = 0;
    let db = 0;
    while (r[a] < 0) { a = (a - 1 + N) % N; da++; }
    while (r[b] < 0) { b = (b + 1) % N; db++; }
    r[i] = (r[a] * db + r[b] * da) / (da + db);
  }
}

// Light vertical smoothing (radii and centres) so the shell doesn't show 1 cm stair-steps.
function smoothAcrossSlices(rings) {
  const keys = [...rings.keys()].sort((a, b) => a - b);
  const copy = new Map();
  for (const k of keys) copy.set(k, { r: Float32Array.from(rings.get(k).r), cx: rings.get(k).cx, cz: rings.get(k).cz });
  const W = [1, 2, 1];
  for (const k of keys) {
    const ring = rings.get(k);
    let wsum = 0;
    let cx = 0;
    let cz = 0;
    const acc = new Float32Array(ring.r.length);
    for (let d = -1; d <= 1; d++) {
      const n = copy.get(k + d);
      if (!n) continue;
      const w = W[d + 1];
      wsum += w;
      cx += n.cx * w;
      cz += n.cz * w;
      for (let i = 0; i < acc.length; i++) acc[i] += n.r[i] * w;
    }
    ring.cx = cx / wsum;
    ring.cz = cz / wsum;
    for (let i = 0; i < acc.length; i++) ring.r[i] = acc[i] / wsum;
  }
}

/** Approximate circumference of a ring (metres). */
export function ringCircumference(ring, extraRadius = 0) {
  const N = ring.r.length;
  let len = 0;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * 2 * Math.PI - Math.PI;
    const a1 = ((i + 1) / N) * 2 * Math.PI - Math.PI;
    const r0 = ring.r[i] + extraRadius;
    const r1 = ring.r[(i + 1) % N] + extraRadius;
    len += Math.hypot(r1 * Math.cos(a1) - r0 * Math.cos(a0), r1 * Math.sin(a1) - r0 * Math.sin(a0));
  }
  return len;
}

/** Ring nearest to a height (metres). */
export function ringAt(rings, y) {
  const iy = Math.round(y / SLICE_STEP);
  for (let d = 0; d < 6; d++) {
    if (rings.has(iy - d)) return rings.get(iy - d);
    if (rings.has(iy + d)) return rings.get(iy + d);
  }
  return null;
}

/**
 * Estimate the arm's shoulder point and hand point from the arm loop centroids.
 * Returns null if we can't find the arm.
 */
export function armLine(armCentroids) {
  if (armCentroids.length < 10) return null;
  const top = armCentroids.slice(-3); // highest slices ~ shoulder / upper arm
  const bottom = armCentroids.slice(0, 3); // lowest slices ~ hand
  const avg = (arr) => ({ x: mean(arr, 'x'), y: mean(arr, 'y'), z: mean(arr, 'z') });
  return { shoulder: avg(top), hand: avg(bottom) };
}

function mean(arr, k) {
  return arr.reduce((s, p) => s + p[k], 0) / arr.length;
}

/** Parse vertex positions and triangulated faces out of an OBJ string. */
export function parseObj(objText) {
  const pos = [];
  const tris = [];
  let i = 0;
  const len = objText.length;
  while (i < len) {
    let j = objText.indexOf('\n', i);
    if (j === -1) j = len;
    const c0 = objText.charCodeAt(i);
    const c1 = objText.charCodeAt(i + 1);
    if (c0 === 118 /* v */ && c1 === 32) {
      const parts = objText.slice(i + 2, j).trim().split(/\s+/);
      pos.push(+parts[0], +parts[1], +parts[2]);
    } else if (c0 === 102 /* f */ && c1 === 32) {
      const parts = objText.slice(i + 2, j).trim().split(/\s+/);
      const idx = parts.map((p) => {
        const v = parseInt(p, 10);
        return v > 0 ? v - 1 : pos.length / 3 + v; // negative indices are relative
      });
      for (let k = 1; k < idx.length - 1; k++) tris.push(idx[0], idx[k], idx[k + 1]);
    }
    i = j + 1;
  }
  return { positions: Float32Array.from(pos), faces: Uint32Array.from(tris) };
}

/** Positions only (kept for callers that don't need faces). */
export function parseObjPositions(objText) {
  return parseObj(objText).positions;
}
