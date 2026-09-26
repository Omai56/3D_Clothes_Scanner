// 3D fit viewer: shows the Bodygram body with a garment "shell" whose size and length come
// from the size chart + fit report. Red = tight, yellow = snug, green = good, blue = relaxed.
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { buildRings, armLine, parseObj, RING_BINS } from '/shared/bodyslices.js';
import { VERDICT_COLOR } from '/shared/fit.js';

const TWO_PI = Math.PI * 2;
const MIN_GAP = 0.006; // metres: shell never sits closer than this so it stays visible

export class FitViewer {
  constructor(container) {
    this.el = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 50);
    this.camera.position.set(0, 1.0, 2.7);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.95, 0);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.minDistance = 1.0;
    this.controls.maxDistance = 4.5;
    this.controls.maxPolarAngle = Math.PI * 0.95;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d2c8, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1.5, 3, 2.5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-2, 1.5, -2);
    this.scene.add(fill);

    // soft ground disc
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(0.6, 48),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.06 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.001;
    this.scene.add(ground);

    this.bodyGroup = new THREE.Group();
    this.garmentGroup = new THREE.Group();
    this.scene.add(this.bodyGroup, this.garmentGroup);

    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  resize() {
    const w = this.el.clientWidth || 320;
    const h = this.el.clientHeight || 480;
    this.renderer.setSize(w, h); // also sets the canvas CSS size so it fits the container
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Load the body OBJ and precompute slice rings. bodyCm = Bodygram measurements in cm. */
  async loadBody(objUrl, bodyCm) {
    if (this._objUrl === objUrl) return;
    this._objUrl = objUrl;
    this.bodyGroup.clear();
    this.garmentGroup.clear();

    const text = await (await fetch(objUrl)).text();
    const group = new OBJLoader().parse(text);
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8d2ca, roughness: 0.9, metalness: 0 });
    group.traverse((o) => {
      if (!o.isMesh) return;
      let g = o.geometry;
      g.deleteAttribute('normal');
      g.deleteAttribute('uv');
      g = BufferGeometryUtils.mergeVertices(g, 1e-6);
      g.computeVertexNormals();
      o.geometry = g;
      o.material = mat;
    });
    this.bodyGroup.add(group);

    this.body = bodyCm;
    const { positions, faces } = parseObj(text);
    this.rings = buildRings(positions, faces, {
      crotchY: bodyCm.insideLegHeight / 100,
      shoulderHalfWidth: bodyCm.acrossBackShoulderWidth / 200,
      neckY: bodyCm.backNeckHeight / 100,
    });
    // Arm loops exist only below the armpit; the shoulder point itself comes from the scan.
    const shoulderY = bodyCm.backNeckHeight / 100 - 0.05;
    const shoulderX = bodyCm.acrossBackShoulderWidth / 200 - 0.01;
    this.arms = {};
    for (const [side, sign] of [['R', 1], ['L', -1]]) {
      const line = armLine(this.rings['arm' + side]);
      if (!line) continue;
      this.arms[side] = { shoulder: { x: sign * shoulderX, y: shoulderY, z: line.shoulder.z }, hand: line.hand };
    }
  }

  /** Show one evaluated size. sizeEval = report.sizes[size]. */
  showFit(garment, sizeEval) {
    this.garmentGroup.clear();
    if (!this.rings) return;
    if (garment.category === 'top') this._buildTop(garment, sizeEval);
    else this._buildBottom(garment, sizeEval);
    this._frame(garment.category);
  }

  _frame(category) {
    const target = category === 'top' ? 1.1 : 0.75;
    this.controls.target.set(0, target, 0);
  }

  // ---------- tops ----------
  _buildTop(garment, ev) {
    const b = this.body;
    const R = ev.regions;
    const neckY = b.backNeckHeight / 100;
    const topY = neckY - 0.03;
    const hemY = (R.length?.height_cm ?? R.hem?.height_cm ?? b.hipHeight) / 100;

    const anchors = [];
    if (R.hem) anchors.push({ y: hemY, delta: cmEaseToRadius(R.hem.ease_cm), color: col(R.hem.verdict) });
    if (R.waist_top) anchors.push({ y: b.waistHeight / 100, delta: cmEaseToRadius(R.waist_top.ease_cm), color: col(R.waist_top.verdict) });
    if (R.chest) anchors.push({ y: b.bustHeight / 100, delta: cmEaseToRadius(R.chest.ease_cm), color: col(R.chest.verdict) });
    if (R.shoulder) anchors.push({ y: neckY - 0.07, delta: R.shoulder.ease_cm / 200, color: col(R.shoulder.verdict) });
    if (!anchors.length) anchors.push({ y: hemY, delta: 0.01, color: col('good') });
    anchors.sort((a, c) => a.y - c.y);

    const mesh = ringsToMesh(this.rings.torso, hemY, topY, anchors);
    if (mesh) this.garmentGroup.add(mesh);

    // sleeves
    const sleeveCm = garment.sizes[ev.size]?.sleeve;
    if (sleeveCm && R.sleeve) {
      const chestDelta = anchors.find((a) => a.color === col(R.chest?.verdict))?.delta ?? 0.01;
      // Sleeve width from the chart when the store gives it (flat width x2 = circumference).
      const armWidth = garment.sizes[ev.size]?.arm_width;
      const radius = armWidth
        ? Math.max((armWidth * 2) / 100 / TWO_PI, (b.upperArmGirthR ?? 30) / 100 / TWO_PI + MIN_GAP)
        : (b.upperArmGirthR ?? 30) / 100 / TWO_PI + 0.012 + Math.max(0, chestDelta) * 0.4;
      for (const side of ['R', 'L']) {
        const arm = this.arms[side];
        if (!arm) continue;
        const tube = sleeveTube(arm, sleeveCm / 100, radius, col(R.arm?.verdict ?? R.sleeve.verdict));
        if (tube) this.garmentGroup.add(tube);
      }
    }
  }

  // ---------- bottoms ----------
  _buildBottom(garment, ev) {
    const b = this.body;
    const R = ev.regions;
    const chart = garment.sizes[ev.size] ?? {};
    const crotchY = b.insideLegHeight / 100;
    const splitY = this.rings.legTopY || crotchY; // where the two leg shells meet the torso shell
    const waistbandY = Math.min(b.waistHeight / 100 + 0.02, chart.rise ? crotchY + chart.rise / 100 : b.waistHeight / 100);
    const ankleY = (b.outerAnkleHeightR ?? 7) / 100 + 0.01;
    // Hem never goes below the ankle: a too-long leg bunches on the shoe rather than covering the foot.
    const hemY = Math.max(ankleY, crotchY - (chart.inseam ?? b.insideLegHeight) / 100);
    const kneeY = (b.kneeHeightR ?? 48) / 100;
    const midThighY = (crotchY + kneeY) / 2;

    const hipDelta = R.hip ? cmEaseToRadius(R.hip.ease_cm) : 0.01;
    const waistDelta = R.waist ? cmEaseToRadius(R.waist.ease_cm) : 0.01;
    const thighDelta = R.thigh ? cmEaseToRadius(R.thigh.ease_cm) : hipDelta;

    // torso part: crotch -> waistband
    const torsoAnchors = [
      { y: splitY, delta: hipDelta, color: col(R.hip?.verdict ?? 'good') },
      { y: b.hipHeight / 100, delta: hipDelta, color: col(R.hip?.verdict ?? 'good') },
      { y: waistbandY, delta: waistDelta, color: col(R.waist?.verdict ?? 'good') },
    ].sort((a, c) => a.y - c.y);
    const torso = ringsToMesh(this.rings.torso, splitY, waistbandY, torsoAnchors);
    if (torso) this.garmentGroup.add(torso);

    // legs: hem -> split
    const legColorLow = col(R.inseam?.verdict ?? R.thigh?.verdict ?? 'good');
    const legAnchors = [
      { y: hemY, delta: thighDelta * 0.9, color: legColorLow },
      { y: kneeY, delta: thighDelta * 0.9, color: legColorLow },
      { y: midThighY, delta: thighDelta, color: col(R.thigh?.verdict ?? 'good') },
      { y: splitY, delta: hipDelta, color: col(R.hip?.verdict ?? 'good') },
    ].sort((a, c) => a.y - c.y);
    for (const rings of [this.rings.right, this.rings.left]) {
      const m = ringsToMesh(rings, hemY, splitY + 0.012, legAnchors);
      if (m) this.garmentGroup.add(m);
    }
  }
}

// ---------- helpers ----------
const colorCache = new Map();
function col(verdict) {
  const hex = VERDICT_COLOR[verdict] ?? VERDICT_COLOR.good;
  if (!colorCache.has(hex)) colorCache.set(hex, new THREE.Color(hex));
  return colorCache.get(hex);
}

/** ease in cm of circumference -> radial offset in metres. */
function cmEaseToRadius(easeCm) {
  return (easeCm ?? 0) / 100 / TWO_PI;
}

function interpAnchors(anchors, y) {
  if (y <= anchors[0].y) return anchors[0];
  const last = anchors[anchors.length - 1];
  if (y >= last.y) return last;
  for (let i = 0; i < anchors.length - 1; i++) {
    const a = anchors[i];
    const c = anchors[i + 1];
    if (y >= a.y && y <= c.y) {
      const t = (y - a.y) / (c.y - a.y || 1);
      return { delta: a.delta + (c.delta - a.delta) * t, color: a.color.clone().lerp(c.color, t) };
    }
  }
  return last;
}

const shellMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.9,
  roughness: 0.75,
  metalness: 0,
});

/** Build a shell mesh from body rings between yBottom..yTop, offset & coloured by anchors. */
function ringsToMesh(ringsMap, yBottom, yTop, anchors) {
  const keys = [...ringsMap.keys()].sort((a, c) => a - c);
  const rings = keys.map((k) => ringsMap.get(k)).filter((r) => r.y >= yBottom - 0.011 && r.y <= yTop + 0.011);
  if (rings.length < 2) return null;
  // Snap the first and last ring to the exact cut heights.
  const list = rings.map((r) => ({ ...r }));
  list[0].y = Math.max(yBottom, 0.005);
  list[list.length - 1].y = yTop;

  const N = RING_BINS;
  const pos = new Float32Array(list.length * N * 3);
  const colors = new Float32Array(list.length * N * 3);
  let p = 0;
  for (const ring of list) {
    const { delta, color } = interpAnchors(anchors, ring.y);
    const off = Math.max(delta, MIN_GAP);
    for (let j = 0; j < N; j++) {
      const ang = (j / N) * TWO_PI - Math.PI;
      const r = ring.r[j] + off;
      pos[p] = ring.cx + r * Math.cos(ang);
      pos[p + 1] = ring.y;
      pos[p + 2] = ring.cz + r * Math.sin(ang);
      colors[p] = color.r;
      colors[p + 1] = color.g;
      colors[p + 2] = color.b;
      p += 3;
    }
  }
  const idx = [];
  for (let i = 0; i < list.length - 1; i++) {
    for (let j = 0; j < N; j++) {
      const a = i * N + j;
      const b = i * N + ((j + 1) % N);
      const c = (i + 1) * N + j;
      const d = (i + 1) * N + ((j + 1) % N);
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return new THREE.Mesh(g, shellMaterial);
}

/** A sleeve as a tapered tube from the shoulder along the arm. */
function sleeveTube(arm, lengthM, radius, color) {
  const s = new THREE.Vector3(arm.shoulder.x, arm.shoulder.y, arm.shoulder.z);
  const h = new THREE.Vector3(arm.hand.x, arm.hand.y, arm.hand.z);
  const dir = h.clone().sub(s);
  if (dir.length() < 0.2) return null;
  dir.normalize();
  const start = s.clone();
  const geo = new THREE.CylinderGeometry(radius * 1.05, radius * 0.85, lengthM, 28, 1, true);
  const colors = new Float32Array(geo.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = color.r;
    colors[i + 1] = color.g;
    colors[i + 2] = color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, shellMaterial);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  mesh.position.copy(start.add(dir.clone().multiplyScalar(lengthM / 2)));
  return mesh;
}
