// Minimal position-based cloth for garment proxies.
//
// A proxy is a tube grid: `rows` rings of `cols` points (closed around). Each ring has its own
// rest circumference (from the size chart) and rows are joined vertically at the garment's
// length. Gravity pulls, distance constraints keep the fabric its size, colliders (the body)
// push it out. Pinned points (shoulder seam, waistband) don't move.

export class Tube {
  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    const n = rows * cols;
    this.pos = new Float32Array(n * 3);
    this.prev = new Float32Array(n * 3);
    this.pinned = new Uint8Array(n);
    this.restAround = new Float32Array(rows); // neighbour spacing around each ring
    this.restDown = new Float32Array(Math.max(0, rows - 1)); // spacing between ring r and r+1
  }

  idx(r, c) {
    return r * this.cols + (((c % this.cols) + this.cols) % this.cols);
  }

  set(r, c, x, y, z) {
    const i = this.idx(r, c) * 3;
    this.pos[i] = x;
    this.pos[i + 1] = y;
    this.pos[i + 2] = z;
    this.prev[i] = x;
    this.prev[i + 1] = y;
    this.prev[i + 2] = z;
  }

  get(r, c) {
    const i = this.idx(r, c) * 3;
    return [this.pos[i], this.pos[i + 1], this.pos[i + 2]];
  }

  pin(r, c, on = true) {
    this.pinned[this.idx(r, c)] = on ? 1 : 0;
  }

  /** Rest lengths from a circumference per row and a vertical spacing per row gap. */
  setRest(circumferenceOfRow, downOfGap) {
    for (let r = 0; r < this.rows; r++) this.restAround[r] = circumferenceOfRow(r) / this.cols;
    for (let r = 0; r < this.rows - 1; r++) this.restDown[r] = downOfGap(r);
    this.restDownCol = null;
  }

  /**
   * Per-column vertical rest lengths taken from the current geometry (for rows that are cones
   * rather than cylinders, e.g. a yoke fanning out from the neckline over the shoulders).
   * rowsFrom..rowsTo (inclusive) use measured lengths; other gaps keep restDown.
   */
  restDownFromGeometry(rowsFrom, rowsTo) {
    if (!this.restDownCol) {
      this.restDownCol = new Float32Array(Math.max(0, this.rows - 1) * this.cols);
      for (let r = 0; r < this.rows - 1; r++) for (let c = 0; c < this.cols; c++) this.restDownCol[r * this.cols + c] = this.restDown[r];
    }
    for (let r = Math.max(0, rowsFrom); r <= Math.min(this.rows - 2, rowsTo); r++) {
      for (let c = 0; c < this.cols; c++) {
        const a = this.get(r, c);
        const b = this.get(r + 1, c);
        this.restDownCol[r * this.cols + c] = Math.max(0.002, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
      }
    }
  }

  /** Bilinear sample at fractional row/column (column wraps). */
  sample(rowF, colF) {
    const r0 = Math.max(0, Math.min(this.rows - 1, Math.floor(rowF)));
    const r1 = Math.min(this.rows - 1, r0 + 1);
    const tr = Math.max(0, Math.min(1, rowF - r0));
    const c0 = Math.floor(colF);
    const tc = colF - c0;
    const p = this.pos;
    const a = this.idx(r0, c0) * 3;
    const b = this.idx(r0, c0 + 1) * 3;
    const c = this.idx(r1, c0) * 3;
    const d = this.idx(r1, c0 + 1) * 3;
    const out = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const top = p[a + k] * (1 - tc) + p[b + k] * tc;
      const bot = p[c + k] * (1 - tc) + p[d + k] * tc;
      out[k] = top * (1 - tr) + bot * tr;
    }
    return out;
  }
}

/**
 * Run the simulation.
 * @param tubes     Tube[]
 * @param colliders array of fn(pos: Float32Array, i: number) that pushes point i out of the body in place
 * @param opts      { steps, iters, dt, gravity, damping }
 */
export function simulate(tubes, colliders, opts = {}) {
  // Quasi-static settle: small steps + heavy damping so cloth never moves more than ~1 cm per
  // step (collisions stay stable), enough steps to fall the length of a garment.
  const steps = opts.steps ?? 140;
  const iters = opts.iters ?? 4;
  const dt = opts.dt ?? 1 / 100;
  const g = opts.gravity ?? 9.81;
  const damping = opts.damping ?? 0.9;
  const gy = -g * dt * dt;
  const settle = opts.settle ?? 30; // constraint-only passes at the end

  for (let s = 0; s < steps + settle; s++) {
    const moving = s < steps;
    // integrate
    if (moving) {
      for (const t of tubes) {
        const { pos, prev, pinned } = t;
        for (let i = 0; i < pinned.length; i++) {
          if (pinned[i]) continue;
          const k = i * 3;
          const vx = (pos[k] - prev[k]) * damping;
          const vy = (pos[k + 1] - prev[k + 1]) * damping;
          const vz = (pos[k + 2] - prev[k + 2]) * damping;
          prev[k] = pos[k];
          prev[k + 1] = pos[k + 1];
          prev[k + 2] = pos[k + 2];
          pos[k] += vx;
          pos[k + 1] += vy + gy;
          pos[k + 2] += vz;
        }
      }
    }
    // constraints + collisions
    for (let it = 0; it < iters; it++) {
      for (const t of tubes) {
        const { rows, cols, pos, pinned } = t;
        for (let r = 0; r < rows; r++) {
          const rest = t.restAround[r];
          for (let c = 0; c < cols; c++) project(pos, pinned, t.idx(r, c), t.idx(r, c + 1), rest, 1);
        }
        const hangFrom = t.hangFrom ?? 0;
        for (let r = 0; r < rows - 1; r++) {
          const restRow = t.restDown[r];
          const diag = Math.hypot(restRow, t.restAround[r]);
          const perCol = t.restDownCol;
          const hanging = r >= hangFrom;
          for (let c = 0; c < cols; c++) {
            const rest = perCol ? perCol[r * cols + c] : restRow;
            // vertical links: symmetric while the cloth falls (so collisions can push rows
            // around), then top-down "follow the leader" in the settle passes, which removes the
            // solver's gravity stretch exactly along links that already hang.
            project(pos, pinned, t.idx(r, c), t.idx(r + 1, c), rest, 1, false, !moving);
            // Hanging fabric: a warp thread below its support never points upward. Without
            // bending stiffness slack cloth would crumple into folds and "shorten"; this keeps
            // every link at least ~30° below horizontal (the lower point is moved).
            if (hanging) {
              const a = t.idx(r, c) * 3;
              const bi = t.idx(r + 1, c);
              if (!pinned[bi]) {
                const b = bi * 3;
                const minDrop = rest * (t.minDropFrac ?? 0.85); // links within ~30° of vertical
                if (pos[b + 1] > pos[a + 1] - minDrop) pos[b + 1] = pos[a + 1] - minDrop;
              }
            }
            // shear: compression-only and light, so a ring that bunches up (collision) can't
            // lever the rows apart vertically and stretch the garment
            project(pos, pinned, t.idx(r, c), t.idx(r + 1, c + 1), diag, 0.2, true);
          }
        }
        const cols_ = t.colliders ?? colliders;
        for (let i = 0; i < pinned.length; i++) {
          if (pinned[i]) continue;
          for (const col of cols_) col(pos, i);
          if (t.extra) t.extra(pos, i);
        }
      }
    }
  }
}

function project(pos, pinned, ia, ib, rest, stiffness, compressionOnly = false, leader = false) {
  const a = ia * 3;
  const b = ib * 3;
  let wa = pinned[ia] ? 0 : 1;
  const wb = pinned[ib] ? 0 : 1;
  if (leader && wb) wa = 0; // a leads, b follows
  if (wa + wb === 0) return;
  let dx = pos[b] - pos[a];
  let dy = pos[b + 1] - pos[a + 1];
  let dz = pos[b + 2] - pos[a + 2];
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-6) return;
  if (compressionOnly && d >= rest) return;
  const corr = ((d - rest) / d) * stiffness;
  dx *= corr;
  dy *= corr;
  dz *= corr;
  const sa = wa / (wa + wb);
  const sb = wb / (wa + wb);
  pos[a] += dx * sa;
  pos[a + 1] += dy * sa;
  pos[a + 2] += dz * sa;
  pos[b] -= dx * sb;
  pos[b + 1] -= dy * sb;
  pos[b + 2] -= dz * sb;
}

/** Capsule collider: keeps points at least `radius(t)` away from segment A-B. */
export function capsuleCollider(ax, ay, az, bx, by, bz, radiusAt) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz || 1e-9;
  return (pos, i) => {
    const k = i * 3;
    const px = pos[k];
    const py = pos[k + 1];
    const pz = pos[k + 2];
    let t = ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / len2;
    if (t < -0.05 || t > 1.05) return;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const cz = az + dz * t;
    const r = radiusAt(t);
    const ox = px - cx;
    const oy = py - cy;
    const oz = pz - cz;
    const d = Math.hypot(ox, oy, oz);
    if (d >= r || d < 1e-6) return;
    const s = r / d;
    pos[k] = cx + ox * s;
    pos[k + 1] = cy + oy * s;
    pos[k + 2] = cz + oz * s;
  };
}
