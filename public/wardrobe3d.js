// 3D wardrobe interior: rail, wooden hangers and "inflated" cloth garments rendered with three.js.
// World units = CSS pixels at z = 0, so HTML labels can be laid over the canvas exactly.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ---------- Garment outlines (200 x 200 art space, y down) ----------
const OUTLINES = {
  tee: 'M72 32 L52 40 L22 64 L38 90 L58 80 L58 178 L142 178 L142 80 L162 90 L178 64 L148 40 L128 32 C120 46 80 46 72 32 Z',
  shirt: 'M74 30 L54 38 L40 62 L28 156 L46 160 L58 88 L58 182 L142 182 L142 88 L154 160 L172 156 L160 62 L146 38 L126 30 L100 50 Z',
  hoodie: 'M74 30 L54 38 L40 62 L28 156 L46 160 L58 88 L58 182 L142 182 L142 88 L154 160 L172 156 L160 62 L146 38 L126 30 C118 44 82 44 74 30 Z',
  jacket: 'M72 28 L50 36 L36 60 L24 158 L46 162 L56 90 L56 184 L144 184 L144 90 L154 162 L176 158 L164 60 L150 36 L128 28 C118 36 82 36 72 28 Z',
  jeans: 'M60 16 L140 16 L148 186 L110 186 L100 74 L90 186 L52 186 Z',
  chinos: 'M58 16 L142 16 L152 186 L110 186 L100 76 L90 186 L48 186 Z',
};
// Art-space y of the line the garment hangs from, and whether it's a top or bottom.
const HANG = { tee: 40, shirt: 38, hoodie: 38, jacket: 36, jeans: 16, chinos: 16 };
const IS_BOTTOM = { jeans: true, chinos: true };
const ART_W = 156, ART_H = 172; // reference size used to scale every garment the same

// ---------- Small helpers ----------
const sm = (v, a, b) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

function polyFromPath(d, seg = 14) {
  const tok = d.match(/[MLCQZ]|-?\d*\.?\d+/g);
  const pts = [];
  let i = 0, cmd = '', cx = 0, cy = 0;
  const num = () => parseFloat(tok[i++]);
  while (i < tok.length) {
    if (/[MLCQZ]/.test(tok[i])) cmd = tok[i++];
    if (cmd === 'M' || cmd === 'L') { cx = num(); cy = num(); pts.push([cx, cy]); }
    else if (cmd === 'C') {
      const x1 = num(), y1 = num(), x2 = num(), y2 = num(), x = num(), y = num();
      for (let s = 1; s <= seg; s++) {
        const t = s / seg, u = 1 - t;
        pts.push([u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x, u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y]);
      }
      cx = x; cy = y;
    } else if (cmd === 'Q') {
      const x1 = num(), y1 = num(), x = num(), y = num();
      for (let s = 1; s <= seg; s++) { const t = s / seg, u = 1 - t; pts.push([u * u * cx + 2 * u * t * x1 + t * t * x, u * u * cy + 2 * u * t * y1 + t * t * y]); }
      cx = x; cy = y;
    } else if (cmd === 'Z') { /* closed implicitly */ }
  }
  // Densify long straight edges so distance/snap is smooth.
  const out = [];
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k], b = pts[(k + 1) % pts.length];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3));
    for (let s = 0; s < n; s++) out.push([a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n]);
  }
  return out;
}

function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function nearest(poly, x, y) {
  let best = Infinity, bx = x, by = y;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [cx, cy] = poly[(i + 1) % poly.length];
    const dx = cx - ax, dy = cy - ay, L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L));
    const px = ax + t * dx, py = ay + t * dy, d = (x - px) ** 2 + (y - py) ** 2;
    if (d < best) { best = d; bx = px; by = py; }
  }
  return [Math.sqrt(best), bx, by];
}

/** Build a closed, pillow-like cloth mesh from a 2D outline. Returns geometry + a z lookup for placing details. */
function inflate(d, { cell = 1.6, k = 2.1, cap = 26, back = 0.65, bump = null } = {}) {
  const poly = polyFromPath(d);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of poly) { minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); }
  minx -= cell; miny -= cell;
  const nx = Math.ceil((maxx - minx) / cell) + 2, ny = Math.ceil((maxy - miny) / cell) + 2;
  const idx = new Int32Array(nx * ny).fill(-1);
  const pos = [], uv = [];
  const zOf = (x, y, dist) => k * Math.sqrt(Math.min(dist, cap)) + (bump ? bump(x, y, dist) : 0);
  let count = 0;
  const verts = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let x = minx + i * cell, y = miny + j * cell;
    if (!inside(poly, x, y)) continue;
    let [dist, px, py] = nearest(poly, x, y);
    if (dist < cell * 0.8) { x = px; y = py; dist = 0; }
    idx[j * nx + i] = count++;
    verts.push([x, y, dist]);
  }
  // front vertices then back vertices
  for (const [x, y, dist] of verts) { pos.push(x - 100, -y, zOf(x, y, dist)); uv.push(x / 200, 1 - y / 200); }
  for (const [x, y, dist] of verts) { pos.push(x - 100, -y, -k * Math.sqrt(Math.min(dist, cap)) * back); uv.push(x / 200, 1 - y / 200); }
  const B = count, index = [];
  const cellIn = (i, j) => i >= 0 && j >= 0 && i < nx - 1 && j < ny - 1 &&
    idx[j * nx + i] >= 0 && idx[j * nx + i + 1] >= 0 && idx[(j + 1) * nx + i] >= 0 && idx[(j + 1) * nx + i + 1] >= 0;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    if (!cellIn(i, j)) continue;
    const a = idx[j * nx + i], b = idx[j * nx + i + 1], c = idx[(j + 1) * nx + i + 1], e = idx[(j + 1) * nx + i];
    index.push(a, e, c, a, c, b);                 // front (facing +z after y flip)
    index.push(a + B, c + B, e + B, a + B, b + B, c + B); // back
    // stitch the silhouette so front and back meet
    const edge = (p, q) => index.push(p, q, q + B, p, q + B, p + B);
    if (!cellIn(i, j - 1)) edge(a, b);
    if (!cellIn(i + 1, j)) edge(b, c);
    if (!cellIn(i, j + 1)) edge(c, e);
    if (!cellIn(i - 1, j)) edge(e, a);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  const zAt = (x, y) => { const [dist] = nearest(poly, x, y); return inside(poly, x, y) ? zOf(x, y, dist) : 0; };
  return { geometry: g, zAt };
}

// ---------- Fabric textures (procedural bump maps) ----------
function canvasTex(draw, repeat) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'); draw(g);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  return t;
}
let TEX = null;
function textures() {
  if (TEX) return TEX;
  TEX = {
    knit: canvasTex(g => {
      g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
      for (let x = 0; x < 256; x += 4) for (let y = 0; y < 256; y += 6) {
        g.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.25})`; g.beginPath(); g.ellipse(x + 2, y + 3, 1.6, 2.8, 0, 0, 7); g.fill();
      }
    }, 9),
    twill: canvasTex(g => {
      g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 2;
      for (let k = -256; k < 512; k += 6) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k + 256, 256); g.stroke(); }
      for (let n = 0; n < 1400; n++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.2})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 1); }
    }, 8),
    nylon: canvasTex(g => {
      g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
      for (let n = 0; n < 3000; n++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1, 1); }
    }, 6),
  };
  return TEX;
}

function fabric(color, kind = 'knit', opts = {}) {
  const c = new THREE.Color(color);
  const t = textures()[kind];
  return new THREE.MeshPhysicalMaterial({
    color: c, roughness: opts.roughness ?? 0.88, metalness: 0,
    sheen: opts.sheen ?? 0.9, sheenRoughness: 0.55, sheenColor: c.clone().lerp(new THREE.Color('#ffffff'), 0.45),
    clearcoat: opts.clearcoat ?? 0, clearcoatRoughness: 0.4,
    bumpMap: t, bumpScale: opts.bumpScale ?? 0.9, envMapIntensity: 0.55, side: THREE.DoubleSide,
  });
}
const shade = (hex, f) => '#' + new THREE.Color(hex).multiplyScalar(f).getHexString();

// ---------- Garments ----------
const GEO = {}; // cached per art (the shape doesn't change with colour)
function garmentGeometry(art) {
  if (GEO[art]) return GEO[art];
  const drape = (x, y, dist) => sm(dist, 0, 9) * (0.9 * Math.sin(x * 0.11 + y * 0.021) + 0.55 * Math.sin(y * 0.083 - x * 0.047) + 0.6 * Math.sin((x - 100) * 0.23) * sm(y, 95, 180));
  const bumps = {
    tee: drape, shirt: drape, hoodie: drape,
    jacket: (x, y, dist) => drape(x, y, dist) * 0.5 + 3.6 * sm(dist, 0, 5) * (0.5 - 0.5 * Math.cos(2 * Math.PI * (y - 26) / 25)),
    jeans: (x, y, dist) => sm(dist, 0, 7) * (0.7 * Math.sin(y * 0.06 + x * 0.03) + 0.8 * Math.sin(y * 0.16) * sm(y, 105, 150) * (1 - sm(y, 150, 175))),
    chinos: (x, y, dist) => sm(dist, 0, 7) * (0.6 * Math.sin(y * 0.05 + x * 0.02) + 0.6 * Math.sin(y * 0.14) * sm(y, 110, 160)),
  };
  GEO[art] = inflate(OUTLINES[art], { bump: bumps[art], k: art === 'jacket' ? 2.5 : 2.1 });
  return GEO[art];
}

function layer(d, mat, z, opts) {
  const { geometry } = inflate(d, { cell: 1.2, k: 0.9, cap: 8, back: 0.2, ...opts });
  const m = new THREE.Mesh(geometry, mat); m.position.z = z; m.castShadow = true; return m;
}

function buildGarment(item) {
  const art = OUTLINES[item.art] ? item.art : 'tee';
  const color = item.color || '#3a5a86';
  const kind = art === 'jeans' ? 'twill' : art === 'jacket' ? 'nylon' : 'knit';
  const mat = fabric(color, kind, art === 'jacket' ? { roughness: 0.42, clearcoat: 0.35, sheen: 0.3, bumpScale: 0.3 } : {});
  const dark = fabric(shade(color, 0.72), kind);
  const { geometry, zAt } = garmentGeometry(art);
  const g = new THREE.Group();
  const body = new THREE.Mesh(geometry, mat); body.castShadow = true; body.receiveShadow = true; g.add(body);
  const on = (x, y, lift = 0.6) => zAt(x, y) + lift;
  const metal = new THREE.MeshStandardMaterial({ color: 0xd9dbe0, metalness: 1, roughness: 0.25 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a14f, metalness: 1, roughness: 0.3 });
  const add = (mesh, x, y, z) => { mesh.position.set(x - 100, -y, z); mesh.castShadow = true; g.add(mesh); return mesh; };

  if (art === 'tee') {
    g.add(layer('M72 32 C80 46 120 46 128 32 L123 30 C116 40 84 40 77 30 Z', dark, on(100, 40, 0.2)));
  }
  if (art === 'shirt') {
    const collar = fabric(shade(color, 1.12), kind);
    g.add(layer('M74 30 L88 54 L100 50 L112 54 L126 30 L116 25 L100 42 L84 25 Z', collar, on(100, 60, 0.8)));
    add(new THREE.Mesh(new THREE.BoxGeometry(5, 128, 1.2), dark), 100, 118, on(100, 118, 0.3));
    for (const y of [70, 94, 118, 142, 166]) {
      const b = add(new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 1.4, 16), new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.35 })), 100, y, on(100, y, 1.2));
      b.rotation.x = Math.PI / 2;
    }
    g.add(layer('M110 76 L128 76 L128 96 L110 96 Z', fabric(shade(color, 0.93), kind), on(119, 86, 0.4)));
  }
  if (art === 'hoodie') {
    const hood = layer('M68 40 C60 4 140 4 132 40 C120 30 80 30 68 40 Z', dark, -3, { k: 1.8, cap: 16, back: 0.5 });
    hood.position.z = -4; g.add(hood);
    g.add(layer('M80 30 C80 14 120 14 120 30 C114 40 86 40 80 30 Z', new THREE.MeshStandardMaterial({ color: shade(color, 0.35), roughness: 1 }), on(100, 34, -0.4), { k: 0.5 }));
    g.add(layer('M70 128 L130 128 L138 162 L62 162 Z', fabric(shade(color, 0.92), kind), on(100, 145, 0.3)));
    g.add(layer('M58 172 L142 172 L142 182 L58 182 Z', dark, on(100, 177, 0.1)));
    for (const x of [92, 108]) {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(x - 100, -40, on(x, 40, 1)), new THREE.Vector3((x - 100) * 1.1, -60, on(x, 60, 1.6)), new THREE.Vector3((x - 100) * 1.05, -80, on(x, 80, 2))]);
      const s = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0xf1ede6, roughness: 0.7 }));
      s.castShadow = true; g.add(s);
      add(new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 5, 10), metal), (x - 100) * 1.05 + 100, 83, on(x, 80, 2));
    }
  }
  if (art === 'jacket') {
    g.add(layer('M74 16 L126 16 L128 34 L72 34 Z', dark, on(100, 30, 0.2), { k: 1.2 }));
    add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 150, 1.6), metal), 100, 108, on(100, 108, 2.2));
    add(new THREE.Mesh(new THREE.BoxGeometry(4, 7, 2), metal), 100, 38, on(100, 38, 3));
  }
  if (art === 'jeans' || art === 'chinos') {
    const top = art === 'jeans' ? 16 : 16;
    g.add(layer(`M${art === 'jeans' ? 60 : 58} ${top} L${art === 'jeans' ? 140 : 142} ${top} L${art === 'jeans' ? 140.6 : 142.7} ${top + 12} L${art === 'jeans' ? 59.4 : 57.3} ${top + 12} Z`, dark, on(100, top + 6, 0.4), { k: 1.1 }));
    for (const x of [70, 86, 114, 130]) add(new THREE.Mesh(new THREE.BoxGeometry(3, 14, 1.6), dark), x, top + 6, on(x, top + 6, 1.6));
    if (art === 'jeans') {
      add(new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 1.2, 14), gold), 100, top + 6, on(100, top + 6, 2)).rotation.x = Math.PI / 2;
      for (const [x, y] of [[66, 34], [134, 34]]) add(new THREE.Mesh(new THREE.SphereGeometry(1.3, 10, 8), gold), x, y, on(x, y, 0.8));
    }
  }
  return g;
}

// ---------- Hangers and rail ----------
const WOOD = () => new THREE.MeshStandardMaterial({ color: 0xb4834f, roughness: 0.42, metalness: 0.05, envMapIntensity: 0.8 });
const CHROME = () => new THREE.MeshStandardMaterial({ color: 0xe6e8ec, metalness: 1, roughness: 0.18 });

function buildHanger(s, bottom) {
  const g = new THREE.Group();
  const hookPts = [[0, -15], [0, -6], [-0.8, -1], [1.8, 4], [6.5, 5.2], [9.8, 1.8], [9.2, -2.2]].map(([x, y]) => new THREE.Vector3(x, y, 0));
  const hook = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(hookPts), 40, 1.2, 10), CHROME());
  hook.castShadow = true; g.add(hook);
  const half = 50 * s;
  if (!bottom) {
    const arc = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-half, -30 * s - 6, 0), new THREE.Vector3(0, -12, 0), new THREE.Vector3(half, -30 * s - 6, 0));
    const bar = new THREE.Mesh(new THREE.TubeGeometry(arc, 48, 3.2, 12), WOOD());
    bar.scale.z = 0.7; bar.castShadow = true; g.add(bar);
    for (const sx of [-1, 1]) { const cap = new THREE.Mesh(new THREE.SphereGeometry(3.2, 14, 10), WOOD()); cap.position.set(sx * half, -30 * s - 6, 0); cap.scale.z = 0.7; g.add(cap); }
  } else {
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(2.8, 2.8, half * 2, 16), WOOD());
    bar.rotation.z = Math.PI / 2; bar.position.y = -20; bar.castShadow = true; g.add(bar);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 6, 8), CHROME()); neck.position.y = -17; g.add(neck);
    for (const sx of [-1, 1]) {
      const clip = new THREE.Mesh(new THREE.BoxGeometry(7, 12, 5), CHROME());
      clip.position.set(sx * 38 * s, -26, 4); clip.castShadow = true; g.add(clip);
    }
  }
  return g;
}

// ---------- Scene controller ----------
export function createWardrobe3D(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const FOV = 30;
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 5000);
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x7a6048, 0.9));
  const key = new THREE.DirectionalLight(0xfff0dc, 2.2);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.6; key.shadow.radius = 6;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0xdfe6ff, 0.6); scene.add(rim);

  const wall = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.16 }));
  wall.position.z = -46; wall.receiveShadow = true; scene.add(wall);

  const railGroup = new THREE.Group(); scene.add(railGroup);
  const itemsGroup = new THREE.Group(); scene.add(itemsGroup);

  let W = 1, H = 1, slots = [], current = [], perPage = 4, hoverIdx = null, running = false, raf = 0;
  const RAIL_TOP = 14;

  function scaleFor() { return Math.min((W / perPage) * 0.84 / ART_W, (H - RAIL_TOP - 40 - 74) / ART_H); }

  function buildRail() {
    railGroup.clear();
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, W - 8, 24), CHROME());
    rail.rotation.z = Math.PI / 2; rail.position.set(0, H / 2 - RAIL_TOP, -2); rail.castShadow = true;
    railGroup.add(rail);
    for (const sx of [-1, 1]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 44, 20), CHROME());
      b.rotation.x = Math.PI / 2; b.position.set(sx * (W / 2 - 10), H / 2 - RAIL_TOP, -24); railGroup.add(b);
    }
  }

  function resize() {
    W = Math.max(1, canvas.clientWidth); H = Math.max(1, canvas.clientHeight);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.position.set(0, 0, (H / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2)));
    camera.updateProjectionMatrix();
    key.position.set(-W * 0.35, H * 0.9, 520); key.target.position.set(0, 0, -40);
    const sc = key.shadow.camera; sc.left = -W; sc.right = W; sc.top = H; sc.bottom = -H; sc.near = 1; sc.far = 2000; sc.updateProjectionMatrix();
    rim.position.set(W * 0.6, H * 0.2, 300);
    wall.scale.set(W * 1.6, H * 1.6, 1);
    buildRail();
    return layout(false);
  }

  /** Place the current items in their slots. Returns each garment's bottom edge (px from canvas top). */
  function layout(animateIn, dir = 0) {
    const s = scaleFor();
    const bottoms = [];
    current.forEach((obj, i) => {
      const x = -W / 2 + (i + 0.5) * (W / perPage);
      const y = H / 2 - RAIL_TOP;
      obj.target.set(x, y, 0);
      if (animateIn) { obj.group.position.set(x + dir * W * 0.7, y, 0); obj.delay = i * 0.09; }
      else obj.group.position.set(x, y, 0);
      // garment hangs below the hook
      const bottom = obj.bottom;
      obj.cloth.scale.setScalar(s);
      // tops: hanger tips sit just under the shoulder seams; bottoms: clips grip the waistband
      obj.cloth.position.set(0, bottom ? HANG[obj.art] * s - 28 : -30 * s - 6 + HANG[obj.art] * s - 3, 3);
      obj.hanger.clear();
      obj.hanger.add(buildHanger(s, bottom));
      const lowest = obj.cloth.position.y - 186 * s;
      bottoms.push(Math.round(RAIL_TOP - lowest));
    });
    return bottoms;
  }

  function show(items, nPerPage, dir = 0) {
    perPage = nPerPage;
    itemsGroup.clear();
    current = items.map(item => {
      const group = new THREE.Group();
      const pivot = new THREE.Group(); group.add(pivot);
      const hanger = new THREE.Group(); pivot.add(hanger);
      const cloth = buildGarment(item); pivot.add(cloth);
      itemsGroup.add(group);
      return { group, pivot, hanger, cloth, art: OUTLINES[item.art] ? item.art : 'tee', bottom: !!IS_BOTTOM[item.art], target: new THREE.Vector3(), delay: 0, lift: 0, turn: 0, born: performance.now() };
    });
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const bottoms = layout(dir !== 0 && running && !reduce, dir); // slide in only while the rail is animating
    renderOnce();
    return bottoms;
  }

  function tick(now) {
    const t = now / 1000;
    current.forEach((o, i) => {
      const age = (now - o.born) / 1000 - o.delay;
      const k = age > 0 ? 0.12 : 0;
      o.group.position.lerp(o.target, k);
      const hovered = hoverIdx === i;
      o.lift += ((hovered ? 7 : 0) - o.lift) * 0.12;
      o.turn += ((hovered ? 0.55 : 0) - o.turn) * 0.08;
      o.pivot.position.y = o.lift;
      o.pivot.rotation.z = 0.022 * Math.sin(t * 0.9 + i * 1.7) * (hovered ? 0.3 : 1);
      o.pivot.rotation.y = o.turn + 0.2 * Math.sin(t * 0.55 + i * 1.1) * (hovered ? 0.2 : 1);
    });
    renderer.render(scene, camera);
  }
  function loop(now) { tick(now); if (running) raf = requestAnimationFrame(loop); }
  function renderOnce() { if (!running) tick(performance.now()); }

  function setActive(on) {
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (on && !running && !reduce) { running = true; raf = requestAnimationFrame(loop); }
    if (!on) { running = false; cancelAnimationFrame(raf); }
    if (!on || reduce) { current.forEach(o => o.group.position.copy(o.target)); renderOnce(); }
  }

  return { show, resize, setActive, hover: i => { hoverIdx = i; renderOnce(); } };
}
