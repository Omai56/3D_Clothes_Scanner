// 3D fit viewer: shows the Bodygram body with a garment "shell" whose size and length come
// from the size chart + fit report. Red = tight, yellow = snug, green = good, blue = relaxed.
import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { buildRings, armLine, parseObj, ringAt, ringCircumference, RING_BINS, SLICE_STEP } from '/shared/bodyslices.js';
import { VERDICT_COLOR, effectiveInseam, waistbandHeight } from '/shared/fit.js';
import { Tube, simulate, capsuleCollider } from '/js/cloth.js';

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
    this.renderer.localClippingEnabled = true; // a bottom is clipped above the hem of a top worn over it
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
    this.meshyGroup = new THREE.Group(); // worn garment meshes: one child group per slot (top / bottom)
    this.slots = {}; // category -> { group, url, gltf, size, box, bands, slices, top, materials }
    this.scene.add(this.bodyGroup, this.garmentGroup, this.meshyGroup);

    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.viewShift = 0; // px: the body slides left while the side panel is open
    this._shiftNow = 0;
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      if (Math.abs(this._shiftNow - this.viewShift) > 0.5) {
        this._shiftNow += (this.viewShift - this._shiftNow) * 0.18;
        this._applyShift();
      } else if (this._shiftNow !== this.viewShift) {
        this._shiftNow = this.viewShift;
        this._applyShift();
      }
      this.renderer.render(this.scene, this.camera);
    });
  }

  _applyShift() {
    const w = this.el.clientWidth || 320;
    const h = this.el.clientHeight || 480;
    if (this._shiftNow === 0) this.camera.clearViewOffset();
    else this.camera.setViewOffset(w, h, this._shiftNow, 0, w, h);
  }

  /** Frame the whole body (used when a body is loaded with nothing on it). */
  frameBody() {
    this.controls.target.set(0, 0.95, 0);
    this.camera.position.set(0, 1.0, 2.7);
  }

  resize() {
    const w = this.el.clientWidth || 320;
    const h = this.el.clientHeight || 480;
    this.renderer.setSize(w, h); // also sets the canvas CSS size so it fits the container
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this._shiftNow) this._applyShift();
  }

  /** Load the body OBJ and precompute slice rings. bodyCm = Bodygram measurements in cm. */
  async loadBody(objUrl, bodyCm) {
    if (this._objUrl === objUrl) return;
    this._objUrl = objUrl;
    this.bodyGroup.clear();
    this.garmentGroup.clear();
    this.meshyGroup.clear();

    const text = await (await fetch(objUrl)).text();
    const group = new OBJLoader().parse(text);
    // Boxers drawn onto the body in the fragment shader (crisp edges whatever the mesh density):
    // from just below the top of the hips to mid-thigh, a lighter waistband, hands excluded.
    const topHip = (bodyCm.topHipHeight ?? bodyCm.hipHeight + 8) / 100 - 0.005;
    const legEnd = bodyCm.insideLegHeight / 100 - 0.11;
    const hipHalf = ((bodyCm.hipGirth ?? 95) / 100 / Math.PI) * 0.62 + 0.02;
    const mat = new THREE.MeshStandardMaterial({ color: 0xd8d2ca, roughness: 0.9, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTopHip = { value: topHip };
      sh.uniforms.uLegEnd = { value: legEnd };
      sh.uniforms.uHipHalf = { value: hipHalf };
      sh.uniforms.uCx = { value: 0.02 };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
varying vec3 vBodyPos;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
vBodyPos = position;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vBodyPos;
uniform float uTopHip, uLegEnd, uHipHalf, uCx;`)
        .replace('#include <color_fragment>', `#include <color_fragment>
          float onBody = step(abs(vBodyPos.x - uCx), uHipHalf);
          float inY = step(uLegEnd, vBodyPos.y) * step(vBodyPos.y, uTopHip);
          float band = step(uTopHip - 0.028, vBodyPos.y);
          vec3 cloth = mix(vec3(0.028, 0.031, 0.040), vec3(0.075, 0.082, 0.100), band);
          diffuseColor.rgb = mix(diffuseColor.rgb, cloth, onBody * inY);`);
    };
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
    // Shoulder tips (where the top of the shoulder turns down into the arm), per side, from the
    // scan's silhouette — Bodygram's across-back width is a contoured tape measure and the tips
    // are lower than the neck base by 8–10 cm, not 5.
    this.shoulderTips = shoulderTipsFromScan(positions, bodyCm.backNeckHeight / 100, this.rings.armpitY, this.rings.torsoCx ?? 0, bodyCm.acrossBackShoulderWidth / 200);
    // Height map of the shoulders (top of the body between armpit and neck base) for draping.
    // Only the top ~5 cm of the shoulders (near-horizontal surface); the sloping sides are handled
    // by the ring colliders. Neck and head excluded.
    this.shoulderMap = buildTopMap(positions, bodyCm.backNeckHeight / 100 - 0.125, bodyCm.backNeckHeight / 100 - 0.03);
    // Top of the feet: trousers that are too long rest on the shoe instead of passing through it.
    this.ankleTopY = (bodyCm.outerAnkleHeightR ?? 7) / 100 + 0.03;
    this.footMap = buildTopMap(positions, 0, this.ankleTopY);
    this.arms = {};
    for (const [side, sign] of [['R', 1], ['L', -1]]) {
      const line = armLine(this.rings['arm' + side]);
      if (!line) continue;
      const tip = this.shoulderTips[side];
      this.arms[side] = { shoulder: { x: tip.x - sign * 0.01, y: tip.y, z: line.shoulder.z }, hand: line.hand };
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

  /** Take off one category ('top' / 'bottom'), or everything. */
  clearGarmentModel(category) {
    if (category) {
      const slot = this.slots[category];
      if (slot) this.meshyGroup.remove(slot.group);
      delete this.slots[category];
    } else {
      this.meshyGroup.clear();
      this.slots = {};
    }
    this._updateLayering();
    this.setMode(this.mode ?? 'look');
  }

  /**
   * Load an AI-generated garment GLB (Tripo/Meshy, made from the flat product photo) and size it
   * from the size chart: height = garment length, width = sleeve tip to sleeve tip (tops) or hip
   * width (bottoms). So S and XL of the same mesh really differ. Shown in "look" mode; the
   * measured shell is shown in "fit" mode (see setMode).
   */
  async loadGarmentModel(url, garment, sizeEval) {
    if (!this.body) return;
    const category = garment.category === 'top' ? 'top' : 'bottom';
    // one slot per category: a top and a bottom can be worn together
    let slot = this.slots[category];
    if (slot && slot.url !== url) {
      this.meshyGroup.remove(slot.group);
      slot = null;
    }
    if (!slot) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      const gltf = await new Promise((resolve, reject) => new GLTFLoader().load(url, resolve, undefined, reject));
      bakeToWorld(gltf.scene); // positions in scene units, float32, node transforms reset
      // Measure the raw mesh once: bounding box + the width of its bottom and top bands
      // (a tee's hem / a pair of trousers' waistband — the parts with no sleeves in them).
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const group = new THREE.Group();
      group.name = category;
      group.add(gltf.scene);
      slot = { group, url, gltf, size: box.getSize(new THREE.Vector3()), box, bands: measureBands(gltf.scene, box), slices: null, top: null, materials: [] };
      this.slots[category] = slot;
      this.meshyGroup.add(group);
    }
    // the placement code reads the current garment's caches from these fields
    this._gltf = slot.gltf;
    this._gltfUrl = slot.url;
    this._gltfSize = slot.size;
    this._gltfBox = slot.box;
    this._gltfBands = slot.bands;
    this._gltfSlices = slot.slices;
    this._gltfTop = slot.top;
    const model = slot.gltf.scene;
    const size = slot.size;
    const box = slot.box;
    const bands = slot.bands;

    const b = this.body;
    const R = sizeEval.regions;
    const chart = garment.sizes?.[sizeEval.size] ?? {};
    const isTop = garment.category === 'top';
    this._garmentName = `${garment.name ?? ''} ${garment.description ?? ''}`;

    // Fabric, not plastic: AI exports tend to come out glossy.
    slot.materials = [];
    const mats0 = slot.materials;
    model.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        m.side = THREE.DoubleSide;
        // AI exports ship roughness/metalness maps that read as latex; drop them for matte cloth.
        m.roughnessMap = null;
        m.metalnessMap = null;
        if ('roughness' in m) m.roughness = 0.92;
        if ('metalness' in m) m.metalness = 0;
        if ('sheen' in m) m.sheen = 0.5;
        if ('transmission' in m) m.transmission = 0;
        if ('clearcoat' in m) m.clearcoat = 0;
        m.envMapIntensity = 0.3;
        mats0.push(m);
      }
    });

    // Tops: the plain placement (mesh kept as generated, sized from the chart and placed on the
    // body) reads better than reshaping it, per Daniel's review. Bottoms: cloth simulation.
    // Set window.__clothSim = true to simulate tops too.
    // Default: the mesh as generated, scaled from the chart and set on the body (Daniel: "make it
    // look good, it doesn't have to adhere"). window.__fitMode = 'warp' / 'sim' for the others.
    try {
      const mode = window.__fitMode ?? 'simple';
      if (mode === 'simple') this._placeSimple(model, box, R, chart, isTop);
      else if (isTop && mode === 'warp') this._placeTop(model, box, R, chart);
      else if (isTop) this._dressTop(model, box, R, chart, garment);
      else this._dressBottoms(model, box, R, chart);
    } catch (e) {
      console.warn('cloth simulation failed, using analytic mapping', e);
      if (isTop) this._deformTop(model, box, R, chart, garment);
      else this._deformBottoms(model, box, R, chart);
    }
    slot.slices = this._gltfSlices;
    slot.top = this._gltfTop;
    this._updateLayering();
    this.setMode(this.mode ?? 'look');
  }

  /** A top over a bottom: the bottom is not drawn above the top's hem (it is under the top there). */
  _updateLayering() {
    const top = this.slots.top;
    const bottom = this.slots.bottom;
    if (!bottom) return;
    const planes = top?.fit ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), top.fit.hemY + 0.03)] : [];
    for (const m of bottom.materials) {
      m.clippingPlanes = planes;
      m.clipShadows = true;
      m.needsUpdate = true;
    }
  }

  get _meshMaterials() {
    return Object.values(this.slots).flatMap((s) => s.materials);
  }

  /**
   * Simple placement (the look Daniel asked for): the generated mesh kept exactly as it is,
   * scaled per axis from the size chart and set on the body, then a soft, neighbour-smoothed
   * push so the body never shows through. No sleeve, yoke or leg reshaping. Sizes still differ
   * in width, depth and length.
   */
  _placeSimple(model, box, R, chart, isTop) {
    const b = this.body;
    const size = this._gltfSize;
    const bands = this._gltfBands;
    const meshes = [];
    model.traverse((o) => {
      if (!o.isMesh || !o.userData.origPos) return;
      meshes.push(o);
      const pos = o.geometry.attributes.position;
      pos.array.set(o.userData.origPos);
      pos.needsUpdate = true;
    });
    const gap = 0.006;
    const neckY = b.backNeckHeight / 100;
    const armpitY = this.rings.armpitY ?? b.bustHeight / 100;
    const legTop = this.rings.legTopY || b.insideLegHeight / 100;
    const torsoCx = this.rings.torsoCx ?? 0;

    let topY;
    let hemY;
    let ext;
    let flatCm;
    let easeCm;
    let bandW;
    let bandD;
    if (isTop) {
      topY = neckY - 0.005;
      hemY = (R.length?.height_cm ?? R.hem?.height_cm ?? b.hipHeight) / 100;
      ext = this._bodyExtent([this.rings.torso], Math.max(hemY, armpitY - 0.25), armpitY - 0.01);
      flatCm = chart.chest ?? chart.hem ?? null;
      easeCm = R.chest?.ease_cm ?? 6;
      bandW = bands.bottom.width;
      bandD = bands.bottom.depth > 0.02 * size.y ? bands.bottom.depth : size.z;
    } else {
      topY = (R.waist?.height_cm ?? b.waistHeight) / 100;
      const wanted = chart.total_length != null ? topY - chart.total_length / 100 : (b.insideLegHeight - (effectiveInseam(chart) ?? b.insideLegHeight)) / 100;
      hemY = Math.max(0.012, wanted);
      ext = this._bodyExtent([this.rings.torso], Math.max(legTop, b.hipHeight / 100 - 0.06), topY);
      flatCm = chart.hip ?? chart.waist ?? null;
      easeCm = R.hip?.ease_cm ?? R.waist?.ease_cm ?? 6;
      bandW = bands.top.width;
      bandD = size.z;
    }
    ext ??= { xmin: -0.17, xmax: 0.17, zmin: -0.11, zmax: 0.11 };
    const bodyW = ext.xmax - ext.xmin;
    const bodyD = ext.zmax - ext.zmin;
    const bodyCx = isTop ? torsoCx : (ext.xmin + ext.xmax) / 2;
    const bodyCz = (ext.zmin + ext.zmax) / 2;
    const easeR = Math.max(MIN_GAP, cmEaseToRadius(easeCm));

    // How much slack the garment has round the body: none = it hugs (slim fit, stretch), a lot =
    // it stands off the chest/back by the ease plus room for folds.
    const bodyC = TWO_PI * Math.sqrt(((bodyW / 2) ** 2 + (bodyD / 2) ** 2) / 2);
    const C = flatCm ? (2 * flatCm) / 100 : bodyC + 2 * TWO_PI * easeR;
    const slack = clamp((C - bodyC) / 0.12, 0, 1);
    const depthM = bodyD + 0.02 + slack * (easeR + (isTop ? 0.03 : 0.015));
    // width: what the chart's circumference allows at that depth, never narrower than the body
    const aHalf = Math.sqrt(Math.max(0, 2 * (C / TWO_PI) ** 2 - (depthM / 2) ** 2));
    const wornWidth = clamp(2 * aHalf, bodyW + 0.02, bodyW + 2 * easeR + 0.06);
    const heightM = Math.max(0.25, topY - hemY);
    const sy = heightM / (size.y || 1);
    const sx = bandW > 0.05 ? wornWidth / bandW : sy;
    const sz = depthM / (bandD || 1);
    const cx = (box.min.x + box.max.x) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const px = bodyCx - cx * sx;
    const py = topY - box.max.y * sy;
    const pz = bodyCz - cz * sz;
    this.lastSimpleFit = { wornWidth, depthM, heightM, sx, sy, sz, bodyW, bodyD };
    const slotSelf = this.slots[isTop ? 'top' : 'bottom'];
    if (slotSelf) slotSelf.fit = { topY, hemY };
    if (slotSelf && !isTop) slotSelf.hull = null; // rebuilt below from the placed mesh
    // Trousers: the flat-lay legs splay outward and are thin pillows. Each mesh leg keeps its
    // shape but slides sideways/forwards so it hangs on the body's own leg line (thigh to
    // ankle), and is widened/deepened just enough to enclose the leg. Fades out at the crotch.
    let legFollow = null;
    if (!isTop) {
      const NB = 64;
      const S = (this._gltfSlices ??= sliceMesh(model, box, NB, (box.min.x + box.max.x) / 2));
      if (S.crotchBand >= 0) {
        const h = box.max.y - box.min.y || 1;
        const meshCx = (box.min.x + box.max.x) / 2;
        const vCrotch = (S.crotchBand + 1) / NB;
        const ankleTop = this.ankleTopY ?? (b.outerAnkleHeightR ?? 7) / 100 + 0.03;
        const rMax = { R: 0, L: 0 };
        for (const side of ['R', 'L']) {
          const map = side === 'R' ? this.rings.right : this.rings.left;
          for (const ring of map.values()) if (ring.y >= ankleTop && ring.y <= legTop) for (let j = 0; j < RING_BINS; j++) if (ring.r[j] > rMax[side]) rMax[side] = ring.r[j];
        }
        legFollow = (x, y, W, i) => {
          const v = clamp((y - box.min.y) / h, 0, 0.9999);
          if (v > vCrotch + 0.05) return;
          const side = x >= meshCx ? 'R' : 'L';
          const ls = lerpStats(S.legs[side], Math.min(v, vCrotch), NB) ?? S.nearestLeg(side, Math.floor(v * NB));
          if (!ls) return;
          const map = side === 'R' ? this.rings.right : this.rings.left;
          const Y = W[i * 3 + 1];
          const c = sampleRing(map, clamp(Y, ankleTop, legTop - 0.005), 0);
          if (!c) return;
          const w = 1 - smoothstep(vCrotch - 0.02, vCrotch + 0.05, v);
          const lcx = ls.cx * sx + px;
          const lcz = ls.cz * sz + pz;
          const need = rMax[side] + gap + 0.012;
          // hem half-width: from the chart if it has one, else a loose leg = ~44 % of the hip
          // measurement (flat), a regular one ~38 %
          const hemFlat = chart.hem ?? (chart.hip ? chart.hip * (/loose|wide|baggy|relaxed/i.test(`${this._garmentName ?? ''}`) ? 0.44 : 0.38) : null);
          const legHW = hemFlat ? Math.max(need, (hemFlat / 100) * 0.5) : Math.max(need, 0.7 * ls.hw * sx);
          const kx = legHW / Math.max(1e-3, ls.hw * sx);
          const kz = Math.max(1, need / Math.max(1e-3, ls.hd * sz));
          const dx = W[i * 3] - lcx;
          const dz = W[i * 3 + 2] - lcz;
          W[i * 3] += w * (c.cx - lcx + dx * (kx - 1));
          W[i * 3 + 2] += w * (c.cz - lcz + dz * (kz - 1));
        };
      }
    }

    // A top over a bottom: the top's lower part flares out over the bottom (one smooth ring =
    // the widest the bottom gets between the top's hem and its waistband, smoothed round, so
    // pockets and folds do not print through), blending in from 12 cm above the waistband.
    const under = isTop ? this.slots.bottom : null;
    let clearUnder = null;
    if (under?.hull && under.fit) {
      const hull = under.hull;
      const NA = 48;
      const ring = new Float32Array(NA);
      const yLo = Math.max(hull.yMin, hemY - 0.03);
      const yHi = Math.min(hull.yMax, under.fit.topY + 0.01);
      for (let a2 = 0; a2 < NA; a2++) {
        const th = (a2 / NA) * TWO_PI - Math.PI;
        let sum = 0;
        let cnt = 0;
        for (let Y = yLo; Y <= yHi; Y += 0.01) {
          sum += hull.at(Y, th);
          cnt++;
        }
        ring[a2] = cnt ? sum / cnt : 0;
      }
      for (let it = 0; it < 6; it++) {
        const r2 = new Float32Array(NA);
        for (let a2 = 0; a2 < NA; a2++) r2[a2] = (ring[(a2 + NA - 1) % NA] + 2 * ring[a2] + ring[(a2 + 1) % NA]) / 4;
        ring.set(r2);
      }
      const wbY = under.fit.topY;
      const refY = Math.max(this.rings.crotchSplitY ?? legTop, hemY);
      clearUnder = (P0, i) => {
        const k = i * 3;
        const Y = P0[k + 1];
        if (Y > wbY + 0.08) return;
        const w = 1 - smoothstep(wbY - 0.02, wbY + 0.08, Y);
        const c = sampleRing(this.rings.torso, Math.max(Y, refY), 0);
        if (!c) return;
        const dx = P0[k] - c.cx;
        const dz = P0[k + 2] - c.cz;
        const th = Math.atan2(dz, dx);
        const fa = ((th + Math.PI) / TWO_PI) * NA;
        const ia = ((Math.floor(fa) % NA) + NA) % NA;
        const ta = fa - Math.floor(fa);
        const rb = ring[ia] * (1 - ta) + ring[(ia + 1) % NA] * ta + 0.004;
        const d = Math.hypot(dx, dz);
        if (d < rb) {
          const f = 1 + (w * Math.min(0.02, rb - d)) / Math.max(d, 1e-6); // never more than 2 cm out: a hem lying on the jeans, not a box
          P0[k] = c.cx + dx * f;
          P0[k + 2] = c.cz + dz * f;
        }
      };
    }

    // Bottoms: the waistband is moulded to the body. Over the top 12 cm the cloth is pulled in
    // to the body's outline plus whatever slack the chart's waist has over the body's waist
    // (a size that is snug at the waist sits tight; a big size stays loose).
    let mouldWaist = null;
    if (!isTop) {
      const wRing = ringAt(this.rings.torso, topY);
      const bodyWaistC = wRing ? ringCircumference(wRing) : 0;
      const chartWaistC = chart.waist ? (2 * chart.waist) / 100 : bodyWaistC;
      const slackR = clamp((chartWaistC - bodyWaistC) / TWO_PI, 0, 0.03);
      const refLo = this.rings.crotchSplitY ?? legTop;
      mouldWaist = (P0, i) => {
        const k = i * 3;
        const Y = P0[k + 1];
        if (Y < topY - 0.12) return;
        const w = smoothstep(topY - 0.12, topY - 0.03, Y);
        const c = sampleRing(this.rings.torso, Math.max(Y, refLo), 0);
        if (!c) return;
        const dx = P0[k] - c.cx;
        const dz = P0[k + 2] - c.cz;
        const smp = sampleRing(this.rings.torso, Math.max(Y, refLo), Math.atan2(dz, dx));
        if (!smp) return;
        const target = smp.r + gap + slackR;
        const d = Math.hypot(dx, dz);
        if (d > target) {
          const f = 1 - (w * (d - target)) / d;
          P0[k] = c.cx + dx * f;
          P0[k + 2] = c.cz + dz * f;
        }
      };
    }

    // bake the scale into the vertices, then push what is inside the body out (smoothed)
    const Cs = this._bodyColliders({ gap, legTop, neckY, armpitY, torsoLo: this.rings.crotchSplitY ?? legTop });
    // tops: the sleeves (beyond the torso's width in the flat mesh) also stay outside the fused
    // torso + arm-root outline above the armpit, so the arms never show through them; the
    // torso panels themselves are left to the clipped rings (or the back bulks up)
    const P = isTop ? (this._gltfTop ??= topProfile(model, box, (box.min.x + box.max.x) / 2, bands)) : null;
    const meshCx0 = (box.min.x + box.max.x) / 2;
    for (const o of meshes) {
      const orig = o.userData.origPos;
      const n = orig.length / 3;
      const sleeveMask = isTop ? new Uint8Array(n) : null;
      if (sleeveMask) for (let i = 0; i < n; i++) sleeveMask[i] = Math.abs(orig[i * 3] - meshCx0) > P.torsoHW * 1.02 ? 1 : 0;
      const cols = isTop ? [...Cs.all, (pos, i) => { if (sleeveMask[i]) Cs.raw(pos, i); }] : Cs.body;
      const W = new Float32Array(orig.length);
      for (let i = 0; i < n; i++) {
        W[i * 3] = orig[i * 3] * sx + px;
        W[i * 3 + 1] = orig[i * 3 + 1] * sy + py;
        W[i * 3 + 2] = orig[i * 3 + 2] * sz + pz;
      }
      if (legFollow) for (let i = 0; i < n; i++) legFollow(orig[i * 3], orig[i * 3 + 1], W, i);
      const adj = (o.userData.adj ??= buildAdjacency(o.geometry));
      const D = new Float32Array(W.length);
      const T = new Float32Array(W.length);
      // the clearance over a worn bottom is applied only through the smoothed passes (a raw
      // final push prints the bottom's shape through the top)
      const collide = (withUnder = true) => {
        for (let i = 0; i < n; i++) {
          if (T[i * 3 + 1] < hemY - (isTop ? 0.08 : 0.01)) continue;
          if (mouldWaist) mouldWaist(T, i);
          for (let pass = 0; pass < 2; pass++) for (const col of cols) col(T, i);
          if (withUnder && clearUnder) clearUnder(T, i);
        }
      };
      for (let it = 0; it < 4; it++) {
        for (let k = 0; k < W.length; k++) T[k] = W[k] + D[k];
        collide();
        for (let k = 0; k < W.length; k++) D[k] = T[k] - W[k];
        const { canon, offsets, list } = adj;
        for (let i = 0; i < n; i++) {
          const c = canon[i];
          const s0 = offsets[c];
          const e = offsets[c + 1];
          if (e === s0) {
            T[i * 3] = D[i * 3];
            T[i * 3 + 1] = D[i * 3 + 1];
            T[i * 3 + 2] = D[i * 3 + 2];
            continue;
          }
          let ax = 0;
          let ay = 0;
          let az = 0;
          for (let j = s0; j < e; j++) {
            const q = list[j] * 3;
            ax += D[q];
            ay += D[q + 1];
            az += D[q + 2];
          }
          const inv = 0.5 / (e - s0);
          T[i * 3] = 0.5 * D[i * 3] + ax * inv;
          T[i * 3 + 1] = 0.5 * D[i * 3 + 1] + ay * inv;
          T[i * 3 + 2] = 0.5 * D[i * 3 + 2] + az * inv;
        }
        D.set(T);
      }
      for (let k = 0; k < W.length; k++) T[k] = W[k] + D[k];
      collide(true);
      if (!isTop) {
        // hull of the placed seat (waistband down to just under the crotch): max distance from
        // the torso ring centre per 1 cm of height and 24 directions, for a top worn over it
        const yMin = legTop - 0.03;
        const yMax = topY + 0.02;
        const NY = Math.max(2, Math.ceil((yMax - yMin) / 0.01) + 1);
        const NA = 24;
        const H = slotSelf.hull?.data ?? new Float32Array(NY * NA);
        for (let i = 0; i < n; i++) {
          const Y = T[i * 3 + 1];
          if (Y < yMin || Y > yMax) continue;
          const c = sampleRing(this.rings.torso, Math.max(Y, this.rings.crotchSplitY ?? legTop), 0);
          if (!c) continue;
          const dx = T[i * 3] - c.cx;
          const dz = T[i * 3 + 2] - c.cz;
          const iy = Math.min(NY - 1, Math.floor((Y - yMin) / 0.01));
          const ia = ((Math.round(((Math.atan2(dz, dx) + Math.PI) / TWO_PI) * NA) % NA) + NA) % NA;
          const d = Math.hypot(dx, dz);
          if (d > H[iy * NA + ia]) H[iy * NA + ia] = d;
        }
        // fill empty cells from their neighbours round the ring
        for (let iy = 0; iy < NY; iy++) {
          for (let ia = 0; ia < NA; ia++) {
            if (H[iy * NA + ia] > 0) continue;
            let best = 0;
            for (let d = 1; d < NA / 2; d++) {
              best = Math.max(H[iy * NA + ((ia + d) % NA)], H[iy * NA + ((ia + NA - d) % NA)]);
              if (best > 0) break;
            }
            H[iy * NA + ia] = best;
          }
        }
        // smooth the hull (pockets, the fly and folds must not print through the top) and
        // sample it bilinearly
        let Hs = H;
        // widen first (the widest points must survive), then soften
        for (let it = 0; it < 4; it++) {
          const useMax = it < 1;
          const N2 = new Float32Array(NY * NA);
          for (let iy = 0; iy < NY; iy++) {
            const y0 = Math.max(0, iy - 1);
            const y1 = Math.min(NY - 1, iy + 1);
            for (let ia = 0; ia < NA; ia++) {
              let sum = 0;
              let cnt = 0;
              let mx = 0;
              for (let yy = y0; yy <= y1; yy++) for (let da = -1; da <= 1; da++) {
                const v = Hs[yy * NA + ((ia + da + NA) % NA)];
                sum += v;
                cnt++;
                if (v > mx) mx = v;
              }
              N2[iy * NA + ia] = useMax ? mx : sum / cnt;
            }
          }
          Hs = N2;
        }
        const Hf = Hs;
        slotSelf.hull = {
          data: H,
          yMin,
          yMax,
          at: (Y, th) => {
            const fy = Math.max(0, Math.min(NY - 1.001, (Y - yMin) / 0.01));
            const iy = Math.floor(fy);
            const ty = fy - iy;
            const fa = ((th + Math.PI) / TWO_PI) * NA;
            const ia = ((Math.floor(fa) % NA) + NA) % NA;
            const ta = fa - Math.floor(fa);
            const v = (yy) => Hf[yy * NA + ia] * (1 - ta) + Hf[yy * NA + ((ia + 1) % NA)] * ta;
            return v(iy) * (1 - ty) + v(Math.min(NY - 1, iy + 1)) * ty;
          },
        };
      }
      const attr = o.geometry.attributes.position;
      attr.array.set(T);
      attr.needsUpdate = true;
      if (!isTop && !o.userData.hemCut) {
        openBottom(o.geometry, orig, box.min.y + (box.max.y - box.min.y) * 0.015);
        o.userData.hemCut = true;
      }
      o.geometry.computeVertexNormals();
      o.geometry.computeBoundingSphere();
    }
    model.position.set(0, 0, 0);
    model.scale.set(1, 1, 1);
  }

  /**
   * Tops: the generated mesh kept intact, fitted by a smooth warp (no per-vertex remodelling):
   *  - height = garment length on this body (chart);
   *  - shoulder line = the body's shoulder width (a dropped seam goes a little down the arm);
   *  - body of the tee = the chart circumference as an ellipse that hangs from the shoulders
   *    where the fabric allows, otherwise pulled in to the body (fitted tee), never inside it;
   *  - sleeves = kept as generated but hinged at the shoulder joint so they hang down along the
   *    arm, length and width from the chart (sleeve, arm_width).
   * Vertices still inside the body are then nudged out with the push spread to their neighbours
   * (bumps, not spikes); everything else stays where the warp put it.
   */
  _placeTop(model, box, R, chart) {
    const b = this.body;
    const bands = this._gltfBands;
    const h = box.max.y - box.min.y || 1;
    const meshCx = (box.min.x + box.max.x) / 2;
    const meshCz = (box.min.z + box.max.z) / 2;
    if (!this._gltfTop) this._gltfTop = topProfile(model, box, meshCx, bands);
    const P = this._gltfTop;
    let gap = 0.005;

    // --- heights: garment length from the chart ---
    const topY = b.backNeckHeight / 100 - 0.005;
    const hemY = (R.length?.height_cm ?? R.hem?.height_cm ?? b.hipHeight) / 100;
    const H = Math.max(0.3, topY - hemY);

    // --- what the tee hangs from: upper torso extent, shoulder width, arm angle ---
    const armpitY = this.rings.armpitY ?? b.bustHeight / 100;
    const neckY = b.backNeckHeight / 100;
    const legTop = this.rings.legTopY || b.insideLegHeight / 100;
    const ext = this._bodyExtent([this.rings.torso], Math.max(hemY, armpitY - 0.25), armpitY - 0.01) ?? { xmin: -0.17, xmax: 0.17, zmin: -0.11, zmax: 0.11 };
    // the back panel hangs from the upper back / shoulder blades, not from the chest-level back
    const extUp = this._bodyExtent([this.rings.torso], armpitY - 0.01, neckY - 0.06);
    const zBack = Math.min(ext.zmin, extUp?.zmin ?? ext.zmin);
    const bodyW = ext.xmax - ext.xmin;
    const bodyD = ext.zmax - zBack;
    const tips = this.shoulderTips ?? { R: { x: 0.21, y: neckY - 0.09 }, L: { x: -0.21, y: neckY - 0.09 } };
    const bodyCx = (tips.R.x + tips.L.x) / 2; // the tee hangs centred between the shoulder tips
    const bodyCz = (zBack + ext.zmax) / 2;
    const shoulderW = tips.R.x - tips.L.x; // tip to tip, straight line
    const armRef = this.arms?.R ?? this.arms?.L;
    const armAng = armRef ? Math.atan2(Math.abs(armRef.hand.x - armRef.shoulder.x), Math.max(0.05, armRef.shoulder.y - armRef.hand.y)) : 0.3;
    const chestFlat = chart.chest ?? chart.hem ?? null;
    const shoulderRatio = chart.shoulder && chestFlat ? clamp(chart.shoulder / chestFlat, 0.75, 1.05) : 0.95;
    const drop = chart.shoulder ? Math.max(0, chart.shoulder / 100 - shoulderW) / 2 : 0; // dropped seam: this far down the arm
    const Ws = shoulderW + 2 * drop * Math.sin(armAng); // worn seam-to-seam width (seams on the shoulder tips)

    // --- body of the tee: chart circumference as an ellipse ---
    const bodyC = TWO_PI * Math.sqrt(((bodyW / 2 + gap) ** 2 + (bodyD / 2 + gap) ** 2) / 2);
    const C = Math.max(chestFlat ? (2 * chestFlat) / 100 : bodyC, bodyC);
    // a tee cut smaller than the body (stretch, slim fit) is worn against the skin: it hugs the
    // body's surface with a bit more clearance so the body mesh never shows through it
    const tight = chestFlat != null && (2 * chestFlat) / 100 < bodyC + 0.03;
    if (tight) gap = 0.012;
    const q2 = 2 * (C / TWO_PI) ** 2;
    let Wb = Ws;
    let Db = 2 * Math.sqrt(Math.max(0, q2 - (Wb / 2) ** 2));
    if (Db < bodyD + 2 * gap) {
      // can't hang straight from the shoulders at this circumference: pulled in to the body
      Db = bodyD + 2 * gap;
      Wb = Math.max(bodyW + 2 * gap, 2 * Math.sqrt(Math.max(0, q2 - (Db / 2) ** 2)));
    }
    Db = Math.min(Db, bodyD + 0.14); // beyond this the excess is folds, not depth
    const meshShoulderHW = P.torsoHW * shoulderRatio;
    const sxBody = Wb / 2 / P.torsoHW;
    const sxSh = Ws / 2 / meshShoulderHW;
    const sz = Db / P.depth;
    this.lastTopFit = { Ws, Wb, Db, bodyW, bodyD, armAng, drop, sleeves: {} };

    // shoulder seam height in the mesh (top of the sleeve next to the torso), per side
    const seamTopY = { R: -Infinity, L: -Infinity };
    const meshes = [];
    model.traverse((o) => {
      if (!o.isMesh || !o.userData.origPos) return;
      meshes.push(o);
      const p = o.userData.origPos;
      for (let i = 0; i < p.length; i += 3) {
        const ax = Math.abs(p[i] - meshCx);
        if (ax < meshShoulderHW * 0.98 || ax > meshShoulderHW + 0.25 * P.torsoHW) continue;
        const side = p[i] >= meshCx ? 'R' : 'L';
        if (p[i + 1] > seamTopY[side]) seamTopY[side] = p[i + 1];
      }
    });
    const seamDefault = box.max.y - 0.06 * h;
    for (const s of ['R', 'L']) if (!Number.isFinite(seamTopY[s])) seamTopY[s] = seamDefault;
    const vArm = P.vArmpit;
    const vTop = clamp(((seamTopY.R + seamTopY.L) / 2 - box.min.y) / h, vArm + 0.08, 0.98);
    const sxAt = (v) => sxBody + (sxSh - sxBody) * smoothstep(vArm, vTop, v);
    const torsoHWAt = (v) => (v <= vArm ? P.torsoHW : P.torsoHW + (meshShoulderHW - P.torsoHW) * clamp((v - vArm) / (vTop - vArm), 0, 1));
    const warpX = (x, v) => bodyCx + (x - meshCx) * sxAt(v);
    const warpY = (v) => hemY + v * H;
    const warpZ = (z) => bodyCz + (z - meshCz) * sz;

    // pass 1: torso warp for every vertex + how much of a sleeve vertex it is. A dropped
    // shoulder seam sits down the arm, so the yoke beyond the body's shoulder point slopes down
    // to it (and the sleeve hangs from there).
    const rampStart = 0.02 * P.torsoHW;
    const rampLen = 0.15 * P.torsoHW;
    const xs = shoulderW / 2;
    const dropY = drop * Math.cos(armAng);
    // The flat-lay mesh has a nearly level shoulder line; the body's shoulder slopes down from
    // the neck base to the shoulder tip. The yoke follows that slope so the seam lands on the
    // tip instead of floating above it; a dropped seam continues down the arm from there.
    const seamWorldY = hemY + vTop * H;
    // The mesh's shoulder line is level; the body's slopes from the neck base down to the
    // shoulder tips. Along the seam line the yoke is lowered onto the scan's own top profile
    // (never lifted), fading out towards the chest; beyond the tips a dropped seam continues
    // down the arm.
    const profile = tips.profile ?? null;
    const neckHW = (b.neckBaseGirth ?? 39) / 100 / TWO_PI + 0.012;
    const restOn = (X0) => {
      // the collar column rests at the trapezius height beside the neck, not on the neck itself
      const X = Math.abs(X0 - bodyCx) < neckHW ? bodyCx + Math.sign(X0 - bodyCx || 1) * neckHW : X0;
      const side = X >= bodyCx ? 'R' : 'L';
      const tip = tips[side];
      const inside = side === 'R' ? X <= tip.x : X >= tip.x;
      const top = inside && profile ? profile(X) : null;
      return (top ?? tip.y) + gap + 0.006;
    };
    // The shoulder line of the mesh (its top ~8 % below the collar) is lowered so it rests on
    // the body's top profile; below that the drop fades out towards the chest. The collar
    // itself keeps its standing height above the shoulder line.
    const yokeDrop = (X, v, yWarp) => {
      const ax = Math.abs(X - bodyCx);
      const vv = smoothstep(vArm - 0.1, vTop, v);
      const yLine = Math.min(yWarp, seamWorldY);
      const slopeDrop = Math.max(0, yLine - restOn(X));
      return (slopeDrop + dropY * smoothstep(xs, Math.max(xs + 0.01, Ws / 2), ax)) * vv;
    };
    // front neckline sits a little lower than the generated collar (flat-lay collars ride high)
    const neckLower = 0.02;
    for (const o of meshes) {
      const orig = o.userData.origPos;
      const n = orig.length / 3;
      const W = new Float32Array(orig.length);
      const wgt = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = orig[i * 3];
        const y = orig[i * 3 + 1];
        const z = orig[i * 3 + 2];
        const v = clamp((y - box.min.y) / h, 0, 1);
        const X = warpX(x, v);
        const yW = warpY(v);
        let Y = yW - yokeDrop(X, v, yW);
        if (warpZ(z) > bodyCz + 0.02 && Math.abs(X - bodyCx) < neckHW * 1.6 && v > vTop - 0.15) {
          Y -= neckLower * smoothstep(vTop - 0.15, vTop - 0.02, v) * (1 - smoothstep(neckHW * 0.9, neckHW * 1.6, Math.abs(X - bodyCx)));
        }
        W[i * 3] = X;
        W[i * 3 + 1] = Y;
        W[i * 3 + 2] = warpZ(z);
        wgt[i] = smoothstep(rampStart, rampStart + rampLen, Math.abs(x - meshCx) - torsoHWAt(v));
      }
      o.userData.W = W;
      o.userData.wgt = wgt;
    }

    // pass 2: each sleeve is a straight tube hanging from the top of the arm. Its axis runs
    // parallel to the arm, offset downward so the sleeve's top rests on the arm and the slack
    // hangs underneath (gravity); its radius comes from the chart's sleeve width (never tighter
    // than the arm), its length from the chart's sleeve length measured from the seam. A dropped
    // seam starts the tube further down the arm. The flat-lay sleeve maps onto it by distance
    // from the side seam (along) and position between its top and underarm edges (around).
    const S2 = (this._gltfSlices ??= sliceTopMesh(model, box, 64, meshCx));
    const armR = (b.upperArmGirthR ?? 30) / 100 / TWO_PI;
    const rsChart = chart.arm_width ? (2 * chart.arm_width) / 100 / TWO_PI : null;
    const rs = Math.max(armR + gap + 0.012, rsChart ?? armR + 0.03);
    const Lsleeve = chart.sleeve ? chart.sleeve / 100 : Math.max(0.1, (P.maxAx - P.torsoHW) * sxSh);
    this.lastTopFit.sleeves = { rs, armR, Lsleeve };
    for (const [side, sgn] of [['R', 1], ['L', -1]]) {
      const arm = this.arms?.[side];
      if (!arm) continue;
      const A0 = armAxis(arm, armR);
      let ux = arm.hand.x - A0.x;
      let uy = arm.hand.y - A0.y;
      let uz = arm.hand.z - A0.z;
      const un = Math.hypot(ux, uy, uz) || 1;
      ux /= un;
      uy /= un;
      uz /= un;
      // "up" across the arm (world up with the along-arm part removed), "front" = along x up
      let vx = -ux * uy;
      let vy = 1 - uy * uy;
      let vz = -uz * uy;
      const vn = Math.hypot(vx, vy, vz) || 1;
      vx /= vn;
      vy /= vn;
      vz /= vn;
      let fx = uy * vz - uz * vy;
      let fy = uz * vx - ux * vz;
      let fz = ux * vy - uy * vx;
      if (fz < 0) {
        fx = -fx;
        fy = -fy;
        fz = -fz;
      }
      const off = rs - armR - gap; // tube axis below the arm axis: the sleeve hangs from its top
      const back = 0.03; // the cap starts a little above the arm's top point, up at the yoke edge
      const along0 = drop - back;
      const C0 = [A0.x + ux * along0 - vx * off, A0.y + uy * along0 - vy * off, A0.z + uz * along0 - vz * off];
      const underDrop = 0;
      (this._sleeveTubes ??= {})[side] = { C0, u: [ux, uy, uz], v: [vx, vy, vz], f: [fx, fy, fz], rs, sgn, underDrop };
      for (const o of meshes) {
        const { origPos: orig, origFront: fr, origDepthS: df, W, wgt } = o.userData;
        const DS = (o.userData.DS ??= new Float32Array(W.length)); // sleeve displacement, smoothed below
        for (let i = 0; i < wgt.length; i++) {
          const w = wgt[i];
          if (w <= 0 || (orig[i * 3] >= meshCx ? 1 : -1) !== sgn) continue;
          const sv = S2.sleeveOf(orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2], true);
          if (!sv) continue;
          const a = sv.s * Lsleeve;
          const wt = w * smoothstep(0, 0.08, sv.s); // the cap stays with the armhole, the tube takes over just beyond it
          const ph = Math.acos(clamp(sv.u, -1, 1));
          // which half of the tube: by depth across the flat-lay pillow (a vertex on the top or
          // underarm edge sits at the seam either way, so a wrong guess there costs nothing)
          const front = df ? df[i] >= 0.5 : fr ? fr[i] === 1 : sv.front;
          const under = clamp(-sv.u, 0, 1) * (1 - smoothstep(0, 0.6, sv.s)) * underDrop;
          const cu = rs * Math.cos(ph);
          const cf = rs * Math.sin(ph) * (front ? 1 : -1);
          const qx = C0[0] + ux * a + vx * cu + fx * cf;
          const qy = C0[1] + uy * a + vy * cu + fy * cf - under;
          const qz = C0[2] + uz * a + vz * cu + fz * cf;
          DS[i * 3] = wt * (qx - W[i * 3]);
          DS[i * 3 + 1] = wt * (qy - W[i * 3 + 1]);
          DS[i * 3 + 2] = wt * (qz - W[i * 3 + 2]);
        }
      }
    }
    // The sleeve displacement is smoothed over the mesh's neighbours before it is applied, so
    // the armhole eases into the tube instead of pleating where the two mappings meet.
    for (const o of meshes) {
      const DS = o.userData.DS;
      if (!DS) continue;
      const W = o.userData.W;
      const n = W.length / 3;
      const { canon, offsets, list } = (o.userData.adj ??= buildAdjacency(o.geometry));
      let cur = DS;
      let nxt = new Float32Array(W.length);
      for (let it = 0; it < 8; it++) {
        for (let i = 0; i < n; i++) {
          const c = canon[i];
          const s0 = offsets[c];
          const e = offsets[c + 1];
          if (e === s0) {
            nxt[i * 3] = cur[i * 3];
            nxt[i * 3 + 1] = cur[i * 3 + 1];
            nxt[i * 3 + 2] = cur[i * 3 + 2];
            continue;
          }
          let ax = 0;
          let ay = 0;
          let az = 0;
          for (let j = s0; j < e; j++) {
            const q = list[j] * 3;
            ax += cur[q];
            ay += cur[q + 1];
            az += cur[q + 2];
          }
          const inv = 0.5 / (e - s0);
          nxt[i * 3] = 0.5 * cur[i * 3] + ax * inv;
          nxt[i * 3 + 1] = 0.5 * cur[i * 3 + 1] + ay * inv;
          nxt[i * 3 + 2] = 0.5 * cur[i * 3 + 2] + az * inv;
        }
        const t = cur;
        cur = nxt;
        nxt = t;
      }
      for (let k = 0; k < W.length; k++) W[k] += cur[k];
      delete o.userData.DS;
      // The generated sleeves carry baked-in creases (visible on the raw mesh). Beyond the cap
      // the sleeve is a plain tube, so every sleeve vertex is put back exactly on the tube's
      // surface (keeping its place along and around it), then the surface is relaxed a little.
      const wgtA = o.userData.wgt;
      const origA = o.userData.origPos;
      for (let i = 0; i < n; i++) {
        if (wgtA[i] < 0.9) continue;
        const sv = S2.sleeveOf(origA[i * 3], origA[i * 3 + 1], origA[i * 3 + 2], true);
        if (!sv || sv.s < 0.08) continue;
        const T = this._sleeveTubes?.[sv.side];
        if (!T) continue;
        const rx = W[i * 3] - T.C0[0];
        const ry = W[i * 3 + 1] - T.C0[1];
        const rz = W[i * 3 + 2] - T.C0[2];
        const a = rx * T.u[0] + ry * T.u[1] + rz * T.u[2];
        let px = rx - a * T.u[0];
        let py = ry - a * T.u[1];
        let pz = rz - a * T.u[2];
        const d = Math.hypot(px, py, pz) || 1e-6;
        const k = (T.rs / d - 1) * smoothstep(0.08, 0.2, sv.s) * wgtA[i] * smoothstep(-0.7, -0.2, sv.u);
        W[i * 3] += px * k;
        W[i * 3 + 1] += py * k;
        W[i * 3 + 2] += pz * k;
      }
      for (let it = 0; it < 6; it++) {
        for (let i = 0; i < n; i++) {
          if (wgtA[i] < 0.6) {
            nxt[i * 3] = W[i * 3];
            nxt[i * 3 + 1] = W[i * 3 + 1];
            nxt[i * 3 + 2] = W[i * 3 + 2];
            continue;
          }
          const c = canon[i];
          const s0 = offsets[c];
          const e = offsets[c + 1];
          if (e === s0) {
            nxt[i * 3] = W[i * 3];
            nxt[i * 3 + 1] = W[i * 3 + 1];
            nxt[i * 3 + 2] = W[i * 3 + 2];
            continue;
          }
          let ax = 0;
          let ay = 0;
          let az = 0;
          for (let j = s0; j < e; j++) {
            const q = list[j] * 3;
            ax += W[q];
            ay += W[q + 1];
            az += W[q + 2];
          }
          const inv = 0.5 / (e - s0);
          nxt[i * 3] = 0.5 * W[i * 3] + ax * inv;
          nxt[i * 3 + 1] = 0.5 * W[i * 3 + 1] + ay * inv;
          nxt[i * 3 + 2] = 0.5 * W[i * 3 + 2] + az * inv;
        }
        W.set(nxt);
      }
    }

    // pass 3: nothing inside the body. The push of each vertex is spread to its neighbours so a
    // shoulder or a hip makes a soft bump in the cloth instead of a spike.
    const Cs = this._bodyColliders({ gap, legTop, neckY, armpitY });
    for (const o of meshes) {
      const W = o.userData.W;
      const n = W.length / 3;
      const adj = (o.userData.adj ??= buildAdjacency(o.geometry));
      const D = new Float32Array(W.length);
      const T = new Float32Array(W.length);
      const wgtC = o.userData.wgt;
      const maxOffBody = tight ? 0.014 : Infinity;
      const pullIn = (P0, i) => {
        if (wgtC[i] > 0.5) return; // sleeves hang from the arm
        const k = i * 3;
        const Y = P0[k + 1];
        // a tee cut smaller than the body lies on the skin everywhere (pulling the loose tee's
        // shoulder caps in tore the sleeve seam, so loose tees are left to hang)
        const maxOff = maxOffBody;
        if (!Number.isFinite(maxOff)) return;
        const c = sampleRing(this.rings.torso, Math.min(Y, neckY - 0.02), 0);
        if (!c) return;
        const dx = P0[k] - c.cx;
        const dz = P0[k + 2] - c.cz;
        const smp = sampleRing(this.rings.torso, Math.min(Y, neckY - 0.02), Math.atan2(dz, dx));
        if (!smp) return;
        const d = Math.hypot(dx, dz);
        const lim = smp.r + gap + maxOff;
        if (d > lim) {
          const f = lim / d;
          P0[k] = c.cx + dx * f;
          P0[k + 2] = c.cz + dz * f;
        }
      };
      const collide = () => {
        for (let i = 0; i < n; i++) {
          if (T[i * 3 + 1] < hemY - 0.01) continue;
          pullIn(T, i);
          for (let pass = 0; pass < 2; pass++) for (const col of Cs.all) col(T, i);
        }
      };
      for (let it = 0; it < 5; it++) {
        for (let k = 0; k < W.length; k++) T[k] = W[k] + D[k];
        collide();
        for (let k = 0; k < W.length; k++) D[k] = T[k] - W[k];
        const { canon, offsets, list } = adj;
        for (let i = 0; i < n; i++) {
          const c = canon[i];
          const s = offsets[c];
          const e = offsets[c + 1];
          if (e === s) {
            T[i * 3] = D[i * 3];
            T[i * 3 + 1] = D[i * 3 + 1];
            T[i * 3 + 2] = D[i * 3 + 2];
            continue;
          }
          let ax = 0;
          let ay = 0;
          let az = 0;
          for (let j = s; j < e; j++) {
            const q = list[j] * 3;
            ax += D[q];
            ay += D[q + 1];
            az += D[q + 2];
          }
          const inv = 0.5 / (e - s);
          T[i * 3] = 0.5 * D[i * 3] + ax * inv;
          T[i * 3 + 1] = 0.5 * D[i * 3 + 1] + ay * inv;
          T[i * 3 + 2] = 0.5 * D[i * 3 + 2] + az * inv;
        }
        D.set(T);
      }
      for (let k = 0; k < W.length; k++) T[k] = W[k] + D[k];
      collide();
      const attr = o.geometry.attributes.position;
      attr.array.set(T);
      attr.needsUpdate = true;
      o.geometry.computeVertexNormals();
      o.geometry.computeBoundingSphere();
      delete o.userData.W;
      delete o.userData.wgt;
    }
    model.position.set(0, 0, 0);
    model.scale.set(1, 1, 1);
  }

  /** Colliders that keep cloth outside the body: torso/leg rings, arm capsules, shoulder tops, floor. */
  _bodyColliders({ gap = 0.008, legTop, neckY, armpitY, legLo = 0, footTop = false, torsoLo = 0 }) {
    const rings = this.rings;
    const b = this.body;
    const ringPush = (map, yHi, yLo = 0) => (pos, i) => {
      const k = i * 3;
      const Y = Math.max(yLo, Math.min(pos[k + 1], yHi));
      const c = sampleRing(map, Y, 0);
      if (!c) return;
      const dx = pos[k] - c.cx;
      const dz = pos[k + 2] - c.cz;
      const th = Math.atan2(dz, dx);
      const smp = sampleRing(map, Y, th);
      if (!smp) return;
      const rb = smp.r + gap;
      const d = Math.hypot(dx, dz);
      if (d < rb) {
        const s = rb / Math.max(d, 1e-6);
        pos[k] = c.cx + dx * s;
        pos[k + 2] = c.cz + dz * s;
      }
    };
    const torsoPush = ringPush(rings.torso, neckY - 0.02);
    // above the armpit the real outline is torso + arm roots fused (the clipped torso rings drop
    // the arm roots so the shell has no lumps): cloth there stays outside the fused outline
    const rawRing = rings.torsoRaw && rings.torsoRaw.size ? ringPush(rings.torsoRaw, neckY - 0.03) : null;
    const raw = (pos, i) => {
      const Y = pos[i * 3 + 1];
      if (rawRing && Y >= armpitY && Y <= neckY - 0.03) rawRing(pos, i);
    };
    // seat of trousers: below the crotch it is still kept outside the fused hull of both thighs
    // (the lowest torso ring), never tucked between them behind the pelvis
    const hullPush = ringPush(rings.torso, neckY - 0.02, torsoLo);
    // below legLo (the ankle) the leg is treated as a straight cylinder: trousers hang past the
    // foot instead of wrapping its outline; the foot itself is handled by the top-of-foot lift
    const legR = ringPush(rings.right, legTop - 0.005, legLo);
    const legL = ringPush(rings.left, legTop - 0.005, legLo);
    const body = (pos, i) => {
      const k = i * 3;
      const Y = pos[k + 1];
      if (Y < legTop) {
        const cR = sampleRing(rings.right, Y, 0);
        const cL = sampleRing(rings.left, Y, 0);
        if (cR && cL) (Math.abs(pos[k] - cR.cx) < Math.abs(pos[k] - cL.cx) ? legR : legL)(pos, i);
        else if (cR) legR(pos, i);
        else if (cL) legL(pos, i);
      } else torsoPush(pos, i);
    };
    const arms = [];
    for (const side of ['R', 'L']) {
      const a = this.arms?.[side];
      if (!a) continue;
      const rUp = (b.upperArmGirthR ?? 30) / 100 / TWO_PI + gap;
      const rWr = (b.wristGirthR ?? 17) / 100 / TWO_PI + gap;
      const s0 = armAxis(a, rUp - gap);
      // the deltoid at the top of the arm is fatter than the upper-arm girth
      arms.push(capsuleCollider(s0.x, s0.y, s0.z, a.hand.x, a.hand.y, a.hand.z, (t) => rUp + (rWr - rUp) * t + rUp * 0.12 * Math.max(0, 1 - t / 0.15)));
      // back of the shoulder joint (posterior deltoid): between the clipped torso rings and the
      // arm capsule there is a wedge of body no collider covers; cloth there showed skin
      if (window.__jointSphere !== false) {
        const sg = Math.sign(a.shoulder.x) || 1;
        const jx = a.shoulder.x - sg * rUp * 0.35;
        const jy = a.shoulder.y - rUp * 1.3;
        const jz = a.shoulder.z - 0.02;
        const jr = rUp * 1.25;
        arms.push((pos, i) => {
          const k = i * 3;
          const ox = pos[k] - jx;
          const oy = pos[k + 1] - jy;
          const oz = pos[k + 2] - jz;
          const d = Math.hypot(ox, oy, oz);
          if (d >= jr || d < 1e-6) return;
          const sc = jr / d;
          pos[k] = jx + ox * sc;
          pos[k + 1] = jy + oy * sc;
          pos[k + 2] = jz + oz * sc;
        });
      }
    }
    const floor = (pos, i) => {
      if (pos[i * 3 + 1] < 0.01) pos[i * 3 + 1] = 0.01;
    };
    // Shoulder tops: cloth whose footprint is over the shoulders rests on them (only points
    // just under the surface are lifted; points beside the body are left alone).
    const neckRing = sampleRing(rings.torso, neckY - 0.05, 0);
    const neckR = (b.neckBaseGirth ?? 39) / 100 / TWO_PI + 0.015;
    const shoulder = (pos, i) => {
      const k = i * 3;
      const Y = pos[k + 1];
      if (Y < armpitY || !this.shoulderMap) return;
      // the neck column is not a shoulder: a collar dipping in front of the neck stays put
      if (neckRing && Math.hypot(pos[k] - neckRing.cx, pos[k + 2] - neckRing.cz) < neckR) return;
      // only cloth whose footprint is over the torso can rest on it: a back or front panel
      // hanging beside the body just below the shoulder line is left to the ring push
      const c = sampleRing(rings.torso, Math.min(Y, neckY - 0.02), 0);
      if (!c) return;
      const dx = pos[k] - c.cx;
      const dz = pos[k + 2] - c.cz;
      const smp = sampleRing(rings.torso, Math.min(Y, neckY - 0.02), Math.atan2(dz, dx));
      if (!smp || Math.hypot(dx, dz) > smp.r + gap) return;
      const top = this.shoulderMap.lookup(pos[k], pos[k + 2]);
      if (top != null && Y < top + gap && Y > top - 0.03) pos[k + 1] = top + gap;
    };
    // Top of the foot: a trouser hem over the shoe rests on it (lifted, then hangs to the floor
    // beside it) instead of passing through the foot.
    const foot = (pos, i) => {
      const k = i * 3;
      const Y = pos[k + 1];
      if (Y > legLo + 0.02 || !this.footMap) return;
      const top = this.footMap.lookup(pos[k], pos[k + 2]);
      if (top == null || Y >= top + gap || Y <= top - 0.2) return;
      // only over the foot itself (inside its outline at this height), never beside it
      const legs = [rings.right, rings.left];
      let over = false;
      for (const map of legs) {
        const c = sampleRing(map, Math.max(0.02, Y), 0);
        if (!c) continue;
        const dx = pos[k] - c.cx;
        const dz = pos[k + 2] - c.cz;
        const smp = sampleRing(map, Math.max(0.02, Y), Math.atan2(dz, dx));
        if (smp && Math.hypot(dx, dz) < smp.r) over = true;
      }
      if (over) pos[k + 1] = top + gap;
    };
    const bodyList = footTop ? [foot, body, floor] : [body, floor];
    // shoulder lift runs before the radial ring push: cloth over the shoulder rests on it
    // instead of being shoved sideways off the slope
    return { body: bodyList, seat: [hullPush, floor], arms: [...arms, floor], torso: [shoulder, body, floor], all: [shoulder, body, ...arms, floor], raw };
  }

  /** Debug: draw proxy tubes as wireframes (window.__showProxy = true). */
  _showProxies(tubes) {
    if (!window.__showProxy) return;
    for (const t of tubes) {
      const pts = [];
      for (let r = 0; r < t.rows; r++) {
        for (let c = 0; c < t.cols; c++) {
          const a = t.get(r, c);
          const b = t.get(r, c + 1);
          pts.push(...a, ...b);
          if (r + 1 < t.rows) {
            const d = t.get(r + 1, c);
            pts.push(...a, ...d);
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.meshyGroup.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x00aaff })));
    }
    this.debugTubes = tubes;
  }

  /**
   * Tops via cloth simulation: a torso tube pinned along the shoulder line + a tube per sleeve
   * pinned at the shoulder joint, each ring sized from the chart (chest) with the mesh's own
   * width profile, dropped under gravity against the body. The AI mesh is then glued to it.
   */
  _dressTop(model, box, R, chart, garment) {
    const b = this.body;
    const NB = 64;
    const h = box.max.y - box.min.y || 1;
    const meshCx = (box.min.x + box.max.x) / 2;
    if (!this._gltfSlices) this._gltfSlices = sliceTopMesh(model, box, NB, meshCx);
    const S = this._gltfSlices;

    const neckY = b.backNeckHeight / 100;
    const topY = neckY + 0.015;
    const shoulderY = neckY - 0.06;
    const hemY = (R.length?.height_cm ?? R.hem?.height_cm ?? b.hipHeight) / 100;
    const bustY = b.bustHeight / 100;
    const armpitY = this.rings.armpitY ?? bustY - 0.04;
    const legTop = this.rings.legTopY || b.insideLegHeight / 100;
    const gap = 0.008;

    // mesh flat width (its units) -> real flat width: anchor at the chest. The width profile is
    // median-smoothed and capped (underarm gussets left in the torso bands otherwise bulge).
    const vOf = (Y) => clamp((Y - hemY) / (topY - hemY), 0, 0.9999);
    const prof = smoothProfile(S.all, NB);
    const hwRaw = (v) => {
      const f = v * NB - 0.5;
      const b0 = clamp(Math.floor(f), 0, NB - 1);
      const b1 = Math.min(NB - 1, b0 + 1);
      const t = clamp(f - b0, 0, 1);
      return prof[b0] * (1 - t) + prof[b1] * t;
    };
    const capHw = Math.max(hwRaw(0.02), hwRaw(vOf(bustY))) * 1.0;
    const hwAt = (v) => Math.min(hwRaw(v), capHw);
    const bustRing = ringAt(this.rings.torso, bustY);
    const fallbackFlat = bustRing ? (ringCircumference(bustRing) + 2 * Math.max(MIN_GAP, cmEaseToRadius(R.chest?.ease_cm)) * TWO_PI) / 2 : 0.5;
    const chestFlat = chart.chest ? chart.chest / 100 : fallbackFlat;
    const hemFlat = chart.hem ? chart.hem / 100 : chestFlat;
    const k = chestFlat / (2 * hwAt(vOf(bustY)));
    const sChest = bustRing ? (2 * chestFlat) / ringCircumference(bustRing) : 1.1;
    // Circumference of the garment at a height: from the chart (hem -> chest, then chest up to
    // the shoulder line); over the shoulders the yoke lies on the body, so follow the body
    // outline with the chest's ease.
    const circAt = (Y) => {
      let flat;
      if (Y <= bustY) flat = hemFlat + (chestFlat - hemFlat) * clamp((Y - hemY) / Math.max(0.01, bustY - hemY), 0, 1);
      else flat = chestFlat;
      const fromChart = 2 * flat;
      if (Y < shoulderY - 0.03) return fromChart;
      const ring = ringAt(this.rings.torso, Y);
      const fromBody = ring ? ringCircumference(ring) * sChest : fromChart;
      const t = clamp((Y - (shoulderY - 0.03)) / 0.03, 0, 1);
      return fromChart + (fromBody - fromChart) * t;
    };

    // ---- torso tube: from the neckline (pinned) down to the hem ----
    // The yoke between neck and shoulder points lies on the shoulders (collider); the body of
    // the tee hangs from the shoulder points under gravity.
    const dy = 0.015;
    const neckTopY = neckY - 0.005; // a crew neck sits at the neck base
    const rows = Math.max(3, Math.ceil((neckTopY - hemY) / dy) + 1);
    const cols = 48;
    const torso = new Tube(rows, cols);
    const rowY = (r) => neckTopY - r * dy;
    const neckRing = ringAt(this.rings.torso, neckY + 0.02);
    const neckC = neckRing ? ringCircumference(neckRing) * 1.15 : 0.5;
    // fabric never smaller than the body it wraps (a tight knit stretches over the body)
    const bodyC = (Y) => {
      const ring = ringAt(this.rings.torso, Math.min(Y, shoulderY - 0.01));
      return ring ? ringCircumference(ring) + TWO_PI * gap : 0;
    };
    const circRow = (r) => (r === 0 ? neckC : Math.max(neckC, circAt(rowY(r)), rowY(r) < shoulderY ? bodyC(rowY(r)) : 0));
    for (let r = 0; r < rows; r++) {
      const Y = rowY(r);
      const C = circRow(r);
      const base = ringAt(this.rings.torso, Y);
      const s = base ? C / ringCircumference(base) : 1;
      for (let c = 0; c < cols; c++) {
        const th = (c / cols) * TWO_PI - Math.PI;
        const smp = sampleRing(this.rings.torso, Y, th) ?? { r: 0.15, cx: 0, cz: 0 };
        const rr = r === 0 ? smp.r * s : Math.max(smp.r + gap, smp.r * s);
        torso.set(r, c, smp.cx + rr * Math.cos(th), Y, smp.cz + rr * Math.sin(th));
      }
    }
    torso.setRest(circRow, () => dy);
    // the yoke (neckline -> shoulder line) is a cone lying on the shoulders: its vertical links
    // are as long as the geometry says, not dy, or the rows would collapse onto the neck
    const yokeRows = Math.ceil((neckTopY - (shoulderY - 0.02)) / dy);
    const collarHalf = hwRaw(0.985) * 1.1; // half-width of the collar band at the top of the flat mesh
    torso.restDownFromGeometry(0, yokeRows);
    torso.hangFrom = yokeRows + 1; // below the yoke the fabric hangs (links point down)
    for (let c = 0; c < cols; c++) torso.pin(0, c); // neckline holds the tee up

    // ---- sleeves ----
    const tubes = [torso];
    const sleeveLen = (chart.sleeve ?? 20) / 100;
    const armBodyR = (b.upperArmGirthR ?? 30) / 100 / TWO_PI;
    const sleeves = {};
    const arms = {};
    for (const side of ['R', 'L']) {
      const a = this.arms?.[side];
      const F = S.frames[side];
      if (!a || !F) continue;
      // sleeve axis starts just under the top of the shoulder, inboard by half the arm radius,
      // so the cap's top surface (axis + radius, outward/up) clears the deltoid
      const sgn0 = Math.sign(a.shoulder.x) || 1;
      const Sx = a.shoulder.x - sgn0 * armBodyR * 0.5;
      const Sy = a.shoulder.y - armBodyR * 0.3;
      const Sz = a.shoulder.z;
      let dx = a.hand.x - Sx;
      let dyy = a.hand.y - Sy;
      let dz = a.hand.z - Sz;
      const len = Math.hypot(dx, dyy, dz) || 1;
      dx /= len;
      dyy /= len;
      dz /= len;
      let nx = -dyy;
      let ny = dx;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      if (nx * Math.sign(Sx) < 0) {
        nx = -nx;
        ny = -ny;
      }
      const Cs = Math.max(chart.arm_width ? (2 * chart.arm_width) / 100 : 4 * F.hw * F.L * k, TWO_PI * (armBodyR + gap));
      const rs = Cs / TWO_PI;
      const drop = rs - (armBodyR + gap);
      const srows = Math.max(3, Math.ceil(sleeveLen / dy) + 1);
      const scols = 24;
      const tube = new Tube(srows, scols);
      // Sleeve cap: the top edge is slanted like an armhole — it meets the shoulder at the top
      // of the arm and sits `capDepth` lower under the arm. The slant fades out down the sleeve.
      const capDepth = Math.min(0.07, sleeveLen * 0.35);
      const capRows = Math.max(1, Math.floor(srows * 0.3));
      // The cap hugs the deltoid (sewn to the armhole) and widens to the sleeve's full width
      // over the cap rows: a rounded shoulder instead of a square one.
      const ramp = (r) => {
        const t = Math.min(1, r / Math.max(1, capRows));
        return t * t * (3 - 2 * t);
      };
      const radiusAt = (r) => armBodyR + gap + (rs - armBodyR - gap) * ramp(r);
      for (let r = 0; r < srows; r++) {
        const fade = Math.max(0, 1 - r / capRows);
        const rr = radiusAt(r);
        const dropR = drop * ramp(r);
        for (let c = 0; c < scols; c++) {
          const phi = (c / scols) * TWO_PI - Math.PI;
          const u = Math.cos(phi); // +1 = top of the arm, -1 = underarm
          const along = Math.min(sleeveLen, r * dy + capDepth * ((1 - u) / 2) * fade);
          const cx = Sx + dx * along - nx * dropR;
          const cy = Sy + dyy * along - ny * dropR;
          const cz = Sz + dz * along;
          tube.set(r, c, cx + rr * u * nx, cy + rr * u * ny, cz + rr * Math.sin(phi));
        }
      }
      tube.setRest((r) => TWO_PI * radiusAt(r), () => dy);
      tube.restDownFromGeometry(0, capRows); // the slanted cap's links are longer than dy
      tube.hangFrom = capRows + 1;
      for (let c = 0; c < scols; c++) tube.pin(0, c);
      sleeves[side] = tube;
      arms[side] = { Sx, Sy, Sz, dx, dy: dyy, dz, nx, ny, rs, drop };
      tubes.push(tube);
    }

    // torso fabric passes between arm and body, so it collides with the body only;
    // sleeves collide with the arm and the body.
    const C = this._bodyColliders({ gap, legTop, neckY, armpitY });
    torso.colliders = C.torso;
    for (const t of Object.values(sleeves)) t.colliders = C.arms; // sleeves wrap the arm; the torso tube handles the body
    const t0 = performance.now();
    simulate(tubes, C.all);
    this.lastSimMs = performance.now() - t0;
    this._showProxies(tubes);
    if (window.__debugTop) {
      // classification histogram of the mesh's sleeve/gusset vertices per side
      const hist = { R: { sleeve: 0, gusset: 0, sBins: new Array(10).fill(0), uBins: new Array(8).fill(0), front: 0 }, L: { sleeve: 0, gusset: 0, sBins: new Array(10).fill(0), uBins: new Array(8).fill(0), front: 0 } };
      model.traverse((o) => {
        if (!o.isMesh) return;
        const orig = o.userData.origPos;
        const fr = o.userData.origFront;
        for (let i = 0; i < orig.length / 3; i++) {
          const x = orig[i * 3];
          const ax = Math.abs(x - meshCx);
          if (ax <= S.torsoHalf) continue;
          const side = x >= meshCx ? 'R' : 'L';
          const sv = S.sleeveOf(x, orig[i * 3 + 1], orig[i * 3 + 2]);
          const H = hist[side];
          if (!sv) { H.gusset++; continue; }
          H.sleeve++;
          H.sBins[Math.min(9, Math.floor(sv.s * 10))]++;
          H.uBins[Math.min(7, Math.floor(((sv.u + 1) / 2) * 8))]++;
          if (fr[i]) H.front++;
        }
      });
      this.debugTop = { frames: S.frames, torsoHalf: S.torsoHalf, sleeveLen: S.sleeveLen, hist, simMs: this.lastSimMs };
    }

    // ---- glue the mesh to the simulated proxies ----
    model.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry;
      const orig = o.userData.origPos;
      const fr = o.userData.origFront;
      const pos = geo.attributes.position;
      const out = pos.array;
      const n = pos.count;
      for (let i = 0; i < n; i++) {
        const x = orig[i * 3];
        const y = orig[i * 3 + 1];
        const z = orig[i * 3 + 2];
        const v = clamp((y - box.min.y) / h, 0, 0.9999);
        const sv = S.sleeveOf(x, y, z);
        const ax = Math.abs(x - meshCx);
        const frontV = fr ? fr[i] === 1 : z >= 0;
        if (sv || ax > S.torsoHalf) {
          const side = sv ? sv.side : x >= meshCx ? 'R' : 'L';
          const tube = sleeves[side];
          if (tube) {
            if (sv) {
              // sleeves: front/back from the sleeve's own mid-plane (normals are noisy on the
              // folded top edge and would scatter neighbours to opposite sides of the tube)
              const phi = sv.front ? Math.acos(sv.u) : -Math.acos(sv.u);
              let p = tube.sample(sv.s * (tube.rows - 1), ((phi + Math.PI) / TWO_PI) * tube.cols);
              // armhole seam: blend the first few cm of sleeve into the torso tube's side so the
              // seam is continuous instead of two surfaces meeting with a step
              if (sv.s < 0.15) {
                const Ys = hemY + v * (topY - hemY);
                const sideTh = x >= meshCx ? 0 : Math.PI;
                const pt = torso.sample(Math.max((neckTopY - Ys) / dy, yokeRows * 0.9), ((sideTh + Math.PI) / TWO_PI) * cols);
                const w = sv.s / 0.15;
                const ws = w * w * (3 - 2 * w);
                p = [pt[0] + (p[0] - pt[0]) * ws, pt[1] + (p[1] - pt[1]) * ws, pt[2] + (p[2] - pt[2]) * ws];
              }
              out[i * 3] = p[0];
              out[i * 3 + 1] = p[1];
              out[i * 3 + 2] = p[2];
              continue;
            }
            // Underarm gusset (beside the torso, under the sleeve): a web between the torso
            // tube's side column at this height and the sleeve's underarm root.
            const Yg = hemY + v * (topY - hemY);
            const sideTh = x >= meshCx ? 0 : Math.PI; // side seam angle on the torso tube
            const pt = torso.sample((neckTopY - Yg) / dy, ((sideTh + Math.PI) / TWO_PI) * cols);
            const phiRoot = frontV ? Math.acos(-1) : -Math.acos(-1);
            const pr = tube.sample(0.02 * (tube.rows - 1), ((phiRoot + Math.PI) / TWO_PI) * tube.cols);
            const t = clamp((ax - S.torsoHalf) / Math.max(0.02, S.sleeveLen * 0.35), 0, 1);
            out[i * 3] = pt[0] + (pr[0] - pt[0]) * t;
            out[i * 3 + 1] = pt[1] + (pr[1] - pt[1]) * t;
            out[i * 3 + 2] = pt[2] + (pr[2] - pt[2]) * t;
            continue;
          }
        }
        const Y = hemY + v * (topY - hemY);
        const band = Math.floor(v * NB);
        const ms = lerpStats(S.all, v, NB) ?? S.nearestAll(band);
        // across the torso panel: per band (smoothed width), so the narrow collar band still
        // spans the whole ring and the underarm bands don't swing vertices around the ring
        const u = clamp((x - ms.cx) / Math.max(1e-3, hwAt(v)), -1, 1);
        const th = frontV ? Math.acos(u) : -Math.acos(u);
        const colF = ((th + Math.PI) / TWO_PI) * cols;
        // Row along the tube. In the yoke (flat mesh's horizontal shoulder line) the row is the
        // distance out from the neck, not the height: the shoulder corner of the mesh belongs on
        // the shoulder-line ring, not beside the collar.
        let rowF = (neckTopY - Y) / dy;
        if (rowF < yokeRows) {
          // only beyond the collar band; the collar itself keeps its height-based rows
          const outward = clamp((Math.abs(x - meshCx) - collarHalf) / Math.max(0.02, S.torsoHalf - collarHalf), 0, 1);
          rowF = Math.max(rowF, outward * yokeRows);
        }
        const p = torso.sample(rowF, colF);
        out[i * 3] = p[0];
        out[i * 3 + 1] = p[1];
        out[i * 3 + 2] = p[2];
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
    });
    model.position.set(0, 0, 0);
    model.scale.set(1, 1, 1);
  }

  /**
   * Trousers via cloth simulation: a seat tube (waistband, pinned -> crotch) whose bottom ring is
   * pinched at the front and back centre of the crotch, so it forms two lobes over the thighs, and
   * a tube per leg hanging from the crotch. Rings are sized from the chart (hip / waist) with the
   * mesh's own width profile. The AI mesh is glued onto the result.
   */
  _dressBottoms(model, box, R, chart) {
    const b = this.body;
    const NB = 64;
    const h = box.max.y - box.min.y || 1;
    const meshCx = (box.min.x + box.max.x) / 2;
    if (!this._gltfSlices) this._gltfSlices = sliceMesh(model, box, NB, meshCx);
    const S = this._gltfSlices;
    if (S.crotchBand < 0) throw new Error('no separate legs in mesh');

    const crotchY = b.insideLegHeight / 100;
    const topY = (R.waist?.height_cm ?? b.waistHeight) / 100;
    const hipY = b.hipHeight / 100;
    const neckY = b.backNeckHeight / 100;
    const armpitY = this.rings.armpitY ?? b.bustHeight / 100;
    const legTopBody = this.rings.legTopY || crotchY;
    // The trouser crotch hangs a little below the body's; worn lower than its rise allows (the
    // waistband slider), the whole garment drops with the waistband and the crotch sags.
    const riseTop = chart.rise != null ? topY - (chart.rise * 0.88) / 100 : legTopBody - 0.02;
    const legTop = Math.min(legTopBody - 0.02, Math.max(legTopBody - 0.12, riseTop));
    const splitY = this.rings.crotchSplitY ?? crotchY;
    const ankleTop = this.ankleTopY ?? (b.outerAnkleHeightR ?? 7) / 100 + 0.03;
    const legYc = (Y) => clamp(Y, ankleTop, legTopBody - 0.005); // leg ring used for a height
    const hemFloor = 0.012; // the hem reaches the floor; excess length pools on the shoe
    const hemWanted = chart.total_length != null ? topY - chart.total_length / 100 : crotchY - (effectiveInseam(chart) ?? b.insideLegHeight) / 100;
    const hemY = Math.max(hemFloor, hemWanted);
    const excess = Math.max(0, hemY - hemWanted);
    const POOL = 0.06;
    const gap = 0.008;

    const vCrotch = (S.crotchBand + 1) / NB;
    const vOfHip = (Y) => clamp(vCrotch + ((Y - legTop) / Math.max(0.01, topY - legTop)) * (1 - vCrotch), vCrotch, 0.9999);
    const vOfLeg = (Y) => clamp(((Y - hemWanted) / Math.max(0.01, legTop - hemWanted)) * vCrotch, 0, vCrotch);
    const hwAll = (v) => (lerpStats(S.all, v, NB) ?? S.nearestAll(Math.floor(v * NB))).hw;
    const hwLeg = (side, v) => (lerpStats(S.legs[side], v, NB) ?? S.nearestLeg(side, Math.floor(v * NB)) ?? { hw: hwAll(v) / 2 }).hw;
    const hipFlat = chart.hip ? chart.hip / 100 : null;
    const hipRing = ringAt(this.rings.torso, Math.max(hipY, splitY));
    const fallbackFlat = hipRing ? (ringCircumference(hipRing) + 2 * Math.max(MIN_GAP, cmEaseToRadius(R.hip?.ease_cm)) * TWO_PI) / 2 : 0.5;
    const k = (hipFlat ?? fallbackFlat) / (2 * hwAll(vOfHip(Math.max(hipY, legTop + 0.01))));
    const circHip = (Y) => 4 * hwAll(vOfHip(Y)) * k; // whole garment around both hips
    const circLeg = (side, Y) => 4 * hwLeg(side, vOfLeg(Y)) * k;
    const waistC = chart.waist ? (2 * chart.waist) / 100 : circHip(topY);

    const dy = 0.015;
    const tubes = [];

    // ---- seat tube: waistband (pinned) -> crotch ----
    // Loose cloth hangs straight down from the widest point above it. The seat is built round
    // ONE vertical axis (the hip ring's centre): per row, the scaled body outline is projected
    // onto that axis's directions and each direction keeps the largest distance seen so far
    // from the waistband down. A tight seat (little ease at the hips) follows the body instead.
    const cols = 48;
    const NSMP = 720;
    const srows = Math.max(3, Math.ceil((topY - legTop) / dy) + 1);
    const seat = new Tube(srows, cols);
    const seatRowY = (r) => Math.max(legTop, topY - r * dy);
    const bodyCAt = (map, Y) => {
      const ring = ringAt(map, Y);
      return ring ? ringCircumference(ring) + TWO_PI * gap : 0;
    };
    const hipC = sampleRing(this.rings.torso, Math.max(hipY, splitY), 0) ?? { cx: 0, cz: -0.05 };
    const binOf = (a2, n) => ((Math.round(((a2 + Math.PI) / TWO_PI) * n) % n) + n) % n;
    // bins the sampled outline missed (the axis is off-centre) are interpolated between their
    // nearest filled neighbours round the ring
    const fillBins = (acc, n, floor) => {
      for (let c = 0; c < n; c++) {
        if (acc[c] >= 0) continue;
        let a = -1;
        let b = -1;
        let da = 0;
        let db = 0;
        for (let d = 1; d < n; d++) if (acc[(c + n - d) % n] >= 0) { a = acc[(c + n - d) % n]; da = d; break; }
        for (let d = 1; d < n; d++) if (acc[(c + d) % n] >= 0) { b = acc[(c + d) % n]; db = d; break; }
        if (a < 0 && b < 0) acc[c] = floor;
        else if (a < 0) acc[c] = b;
        else if (b < 0) acc[c] = a;
        else acc[c] = (a * db + b * da) / (da + db);
      }
    };
    // Where the garment is genuinely smaller than the body (stretch denim on a thigh), the cloth
    // follows the body; everywhere else it hangs straight from the widest point above.
    const tightAt = (C, bodyC) => C < bodyC + 0.01;
    const perimOf = (ring, n, ox, oz) => {
      let per = 0;
      let x0 = 0;
      let z0 = 0;
      for (let c = 0; c <= n; c++) {
        const cc = c % n;
        const th = (cc / n) * TWO_PI - Math.PI;
        const x = ox + ring[cc] * Math.cos(th);
        const z = oz + ring[cc] * Math.sin(th);
        if (c > 0) per += Math.hypot(x - x0, z - z0);
        x0 = x;
        z0 = z;
      }
      return per;
    };
    // One row of hanging cloth: `acc` = the body's (scaled) outline at this height, `colMax` = the
    // running maximum from the last point where the fabric hugged the body. Where the garment is
    // smaller than the body it hugs (and the running maximum restarts); otherwise it hangs
    // straight from the widest point above, shrunk uniformly so its perimeter never exceeds the
    // fabric's circumference, and never inside the body.
    const hangRow = (acc, colMax, n, C, bodyC, out, body = acc) => {
      if (tightAt(C, bodyC)) {
        for (let c = 0; c < n; c++) {
          colMax[c] = acc[c];
          out[c] = acc[c];
        }
        return true;
      }
      for (let c = 0; c < n; c++) if (acc[c] > colMax[c]) colMax[c] = acc[c];
      const per = perimOf(colMax, n, 0, 0);
      const f = clamp(Math.max(C, bodyC) / Math.max(1e-6, per), 0.5, 1.5);
      for (let c = 0; c < n; c++) out[c] = Math.max(body[c], colMax[c] * f);
      return false;
    };
    const seatDist = new Float32Array(srows * cols);
    const seatColMax = new Float32Array(cols);
    for (let r = 0; r < srows; r++) {
      const Y = seatRowY(r);
      const Yc = Math.max(Y, splitY);
      const C = r === 0 ? waistC : circHip(Y);
      const base = ringAt(this.rings.torso, Yc);
      const sc = base ? C / ringCircumference(base) : 1;
      const acc = new Float32Array(cols).fill(-1);
      for (let j = 0; j < NSMP; j++) {
        const th = (j / NSMP) * TWO_PI - Math.PI;
        const smp = sampleRing(this.rings.torso, Yc, th) ?? { r: 0.15, cx: hipC.cx, cz: hipC.cz };
        const rr0 = Math.max(smp.r + gap, smp.r * sc);
        const px = smp.cx + rr0 * Math.cos(th) - hipC.cx;
        const pz = smp.cz + rr0 * Math.sin(th) - hipC.cz;
        const bin = binOf(Math.atan2(pz, px), cols);
        const d = Math.hypot(px, pz);
        if (d > acc[bin]) acc[bin] = d;
      }
      fillBins(acc, cols, 0.08);
      const rowOut = seatDist.subarray(r * cols, (r + 1) * cols);
      if (r === 0) {
        for (let c = 0; c < cols; c++) {
          seatColMax[c] = acc[c];
          rowOut[c] = acc[c];
        }
      } else hangRow(acc, seatColMax, cols, C, bodyCAt(this.rings.torso, Yc), rowOut);
    }
    const seatRest = new Float32Array(srows);
    for (let r = 0; r < srows; r++) {
      const Y = seatRowY(r);
      let per = 0;
      let px0 = 0;
      let pz0 = 0;
      for (let c = 0; c <= cols; c++) {
        const cc = c % cols;
        const th = (cc / cols) * TWO_PI - Math.PI;
        const d = seatDist[r * cols + cc];
        const px = hipC.cx + d * Math.cos(th);
        const pz = hipC.cz + d * Math.sin(th);
        if (c < cols) seat.set(r, cc, px, Y, pz);
        if (c > 0) per += Math.hypot(px - px0, pz - pz0);
        px0 = px;
        pz0 = pz;
      }
      seatRest[r] = Math.max(per, r === 0 ? waistC : circHip(Y), bodyCAt(this.rings.torso, Math.max(Y, splitY)));
    }
    seat.setRest((r) => seatRest[r], (r) => Math.max(0.002, seatRowY(r) - seatRowY(r + 1)));
    for (let c = 0; c < cols; c++) seat.pin(0, c);
    tubes.push(seat);

    // ---- legs: crotch (pinned) -> hem ----
    const lcols = 32;
    const lrows = Math.max(3, Math.ceil((legTop - hemY) / dy) + 1);
    const legRowY = (r) => Math.max(hemY, legTop - r * dy);
    const legs = {};
    for (const side of ['R', 'L']) {
      const sgn = side === 'R' ? 1 : -1;
      const legMap = side === 'R' ? this.rings.right : this.rings.left;
      const tube = new Tube(lrows, lcols);
      // Baggy legs hang straight down from the widest part of the leg (thigh); only a leg cut
      // close to the body follows the knee and calf. 8 cm of ease at the thigh = fully straight.
      const thighY = legTop - 0.04;
      // A leg that is not tight hangs as a straight VERTICAL tube round one fixed axis (the
      // thigh's centre): in every direction its radius is the largest the leg needs anywhere
      // along it, and it also covers the seat above it (the buttocks and belly), so the cloth
      // falls straight from the seat instead of stepping in under it. Under ~1 cm of thigh ease
      // the cloth follows the leg; from 2.5 cm it is fully straight.
      const thighC = sampleRing(legMap, legYc(thighY), 0) ?? { cx: sgn * 0.09, cz: -0.06, r: 0.09 };
      const ankleC = sampleRing(legMap, ankleTop + 0.02, 0) ?? thighC;
      // The tube's axis is the leg's own straight line from the thigh to the ankle (legs splay
      // and lean in a scan; loose cloth hangs along the leg, it does not stay vertical and bulge
      // where the calf swings out). Rings are measured from that axis.
      const axisAt = (Y) => {
        const t = clamp((thighY - Y) / Math.max(0.05, thighY - ankleTop - 0.02), 0, 1);
        return [thighC.cx + (ankleC.cx - thighC.cx) * t, thighC.cz + (ankleC.cz - thighC.cz) * t];
      };
      let [ax, az] = axisAt(thighY);
      const distRow = new Float32Array(lrows * lcols); // scaled body distance from the axis per row/column
      const axisRow = new Float32Array(lrows * 2);
      const tightRow = new Uint8Array(lrows);
      const colAll = new Float32Array(lcols); // running maximum from the seat down
      // the seat's bottom ring on this side: its outer, front and back extents carry on down
      // the leg (not the inner side, which is the inseam hanging from the crotch)
      {
        const rS = srows - 1;
        const cR0 = sampleRing(this.rings.right, legYc(legTop), 0);
        const cL0 = sampleRing(this.rings.left, legYc(legTop), 0);
        const cMid = ((cR0?.cx ?? 0.1) + (cL0?.cx ?? -0.1)) / 2;
        const inner = sgn > 0 ? Math.PI : 0;
        for (let c = 0; c < cols; c++) {
          const q = seat.get(rS, c);
          if ((q[0] - cMid) * sgn < -0.005) continue;
          const px = q[0] - ax;
          const pz = q[2] - az;
          const a2 = Math.atan2(pz, px);
          const da = Math.abs(Math.atan2(Math.sin(a2 - inner), Math.cos(a2 - inner)));
          if (da < (50 * Math.PI) / 180) continue;
          const bin = binOf(a2, lcols);
          const d = Math.hypot(px, pz);
          for (const bb of [bin, (bin + 1) % lcols, (bin + lcols - 1) % lcols]) if (d > colAll[bb]) colAll[bb] = d;
        }
      }
      for (let r = 0; r < lrows; r++) {
        const Y = legRowY(r);
        const Yc = legYc(Y);
        const C = circLeg(side, Y);
        const base = ringAt(legMap, Yc);
        const sc = base ? C / ringCircumference(base) : 1;
        const cc0 = sampleRing(legMap, Yc, 0) ?? thighC;
        [ax, az] = axisAt(Yc);
        axisRow[r * 2] = ax;
        axisRow[r * 2 + 1] = az;
        const acc = new Float32Array(lcols).fill(-1);
        const accB = new Float32Array(lcols).fill(-1);
        for (let j = 0; j < NSMP; j++) {
          const th = (j / NSMP) * TWO_PI - Math.PI;
          const smp = sampleRing(legMap, Yc, th) ?? { r: 0.08, cx: cc0.cx, cz: cc0.cz };
          const rr0 = Math.max(smp.r + gap, smp.r * sc);
          const px = smp.cx + rr0 * Math.cos(th) - ax;
          const pz = smp.cz + rr0 * Math.sin(th) - az;
          const bin = binOf(Math.atan2(pz, px), lcols);
          const d = Math.hypot(px, pz);
          if (d > acc[bin]) acc[bin] = d;
          const rb = smp.r + gap;
          const bx = smp.cx + rb * Math.cos(th) - ax;
          const bz = smp.cz + rb * Math.sin(th) - az;
          const binB = binOf(Math.atan2(bz, bx), lcols);
          const dB = Math.hypot(bx, bz);
          if (dB > accB[binB]) accB[binB] = dB;
        }
        fillBins(acc, lcols, 0.05);
        fillBins(accB, lcols, 0.05);
        tightRow[r] = hangRow(acc, colAll, lcols, C, bodyCAt(legMap, Yc), distRow.subarray(r * lcols, (r + 1) * lcols), accB) ? 1 : 0;
      }
      const restRow = new Float32Array(lrows);
      for (let r = 0; r < lrows; r++) {
        const Y = legRowY(r);
        let per = 0;
        let px0 = 0;
        let pz0 = 0;
        for (let c = 0; c <= lcols; c++) {
          const cc = c % lcols;
          const th = (cc / lcols) * TWO_PI - Math.PI;
          const d = distRow[r * lcols + cc];
          const px = axisRow[r * 2] + d * Math.cos(th);
          const pz = axisRow[r * 2 + 1] + d * Math.sin(th);
          if (c < lcols) tube.set(r, cc, px, Y, pz);
          if (c > 0) per += Math.hypot(px - px0, pz - pz0);
          px0 = px;
          pz0 = pz;
        }
        restRow[r] = Math.max(per, circLeg(side, Y), bodyCAt(legMap, legYc(Y)));
      }
      tube.setRest((r) => restRow[r], (r) => Math.max(0.002, legRowY(r) - legRowY(r + 1)));
      for (let c = 0; c < lcols; c++) tube.pin(0, c);
      // the two legs never cross the line between the thighs. That line is the real midline of
      // this scan (bodies are not symmetric about x = 0), per row.
      const midX = new Float32Array(lrows);
      for (let r = 0; r < lrows; r++) {
        const Yc = legYc(legRowY(r));
        const cR = sampleRing(this.rings.right, Yc, 0);
        const cL = sampleRing(this.rings.left, Yc, 0);
        midX[r] = cR && cL ? (cR.cx + cL.cx) / 2 : 0;
      }
      tube.extra = (pos, i) => {
        const r = Math.min(lrows - 1, Math.floor(i / lcols));
        const m = midX[r];
        if ((pos[i * 3] - m) * sgn < 0.004) pos[i * 3] = m + 0.004 * sgn;
        // crotch gusset: for the first rows under the crotch the inner side of each leg lies
        // flat on the midline, so the two legs meet like an inseam instead of leaving a notch
        if (r < 6 && Math.abs(pos[i * 3] - m) < 0.03) pos[i * 3] = m + 0.004 * sgn;
      };
      legs[side] = tube;
      tubes.push(tube);
    }

    // the leg colliders use the real outline at every height (the hem is pushed round the shoe,
    // which reads as the hem breaking on it); the tube's rest sizes come from the ankle ring
    const Cs = this._bodyColliders({ gap, legTop: legTopBody, neckY, armpitY, torsoLo: splitY });
    for (const t of tubes) t.colliders = t === seat ? Cs.seat : Cs.body;
    const t0 = performance.now();
    simulate(tubes, Cs.body);
    this.lastSimMs = performance.now() - t0;
    this._showProxies(tubes);

    // ---- glue ----
    model.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry;
      const orig = o.userData.origPos;
      const fr = o.userData.origFront;
      const df = o.userData.origDepth;
      const pos = geo.attributes.position;
      const out = pos.array;
      const n = pos.count;
      // ring angle for a vertex: front/back layer by the flag, but within the side band the
      // angle follows the vertex's depth so the edge wraps round the side of the body
      const angleOf = (u, frontV, i) => {
        const base = frontV ? Math.acos(u) : -Math.acos(u);
        const au = Math.abs(u);
        if (au < 0.8 || !df) return base;
        const f = df[i];
        const phi = Math.acos(au);
        const side = u >= 0 ? phi * (2 * f - 1) : Math.PI - phi * (2 * f - 1);
        const w = smoothstep(0.8, 0.95, au);
        // shortest blend between the two angles
        let d = side - base;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        return base + w * d;
      };
      for (let i = 0; i < n; i++) {
        const x = orig[i * 3];
        const y = orig[i * 3 + 1];
        const z = orig[i * 3 + 2];
        const v = clamp((y - box.min.y) / h, 0, 0.9999);
        const band = Math.floor(v * NB);
        const frontV = fr ? fr[i] === 1 : z >= 0;
        const legPos = () => {
          const side = x >= meshCx ? 'R' : 'L';
          const tube = legs[side];
          const ls = lerpStats(S.legs[side], v, NB) ?? S.nearestLeg(side, band) ?? lerpStats(S.all, v, NB);
          const u = clamp((x - ls.cx) / ls.hw, -1, 1);
          const th = angleOf(u, frontV, i);
          const Yl = hemWanted + (Math.min(v, vCrotch) / vCrotch) * (legTop - hemWanted);
          let Y = Yl;
          let bump = 0;
          if (excess > 0 && Yl < hemY + POOL) {
            const t = clamp((Yl - hemWanted) / (hemY + POOL - hemWanted), 0, 1);
            Y = hemY + t * POOL;
            bump = Math.min(0.008, excess * 0.1) * Math.sin(Math.PI * t);
          }
          let p = tube.sample((legTop - Y) / dy, ((th + Math.PI) / TWO_PI) * lcols);
          if (bump) {
            const cc = sampleRing(side === 'R' ? this.rings.right : this.rings.left, legYc(Y), 0) ?? { cx: p[0], cz: p[2] };
            const dx = p[0] - cc.cx;
            const dz = p[2] - cc.cz;
            const d = Math.hypot(dx, dz) || 1;
            p = [p[0] + (dx / d) * bump, p[1], p[2] + (dz / d) * bump];
          }
          return p;
        };
        const seatPos = () => {
          const ms = lerpStats(S.all, v, NB) ?? S.nearestAll(band);
          const u = clamp((x - ms.cx) / ms.hw, -1, 1);
          const th = angleOf(u, frontV, i);
          const Y = legTop + ((v - vCrotch) / Math.max(1e-3, 1 - vCrotch)) * (topY - legTop);
          return seat.sample((topY - Y) / dy, ((th + Math.PI) / TWO_PI) * cols);
        };
        // Around the crotch the two mappings (one loop round both hips vs one per leg) are
        // blended, so the seat and the legs join as one continuous piece of cloth.
        const TZ = 0.05;
        let p;
        if (v < vCrotch - TZ) p = legPos();
        else if (v > vCrotch + TZ) p = seatPos();
        else {
          const t = smoothstep(vCrotch - TZ, vCrotch + TZ, v);
          const a = legPos();
          const s = seatPos();
          p = [a[0] + (s[0] - a[0]) * t, a[1] + (s[1] - a[1]) * t, a[2] + (s[2] - a[2]) * t];
        }
        out[i * 3] = p[0];
        out[i * 3 + 1] = p[1];
        out[i * 3 + 2] = p[2];
      }
      pos.needsUpdate = true;
      if (!o.userData.hemCut) {
        openBottom(geo, orig, box.min.y + h * 0.015);
        o.userData.hemCut = true;
      }
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
    });
    model.position.set(0, 0, 0);
    model.scale.set(1, 1, 1);
  }

  /**
   * Reshape a flat-lay top mesh onto the body: the torso wraps the body's rings (pushed out by
   * the chart's ease, hanging straight from the chest), the sleeves become tubes along the arms.
   */
  _deformTop(model, box, R, chart, garment) {
    const b = this.body;
    const NB = 64;
    const h = box.max.y - box.min.y || 1;
    const meshCx = (box.min.x + box.max.x) / 2;
    if (!this._gltfSlices) this._gltfSlices = sliceTopMesh(model, box, NB, meshCx);
    const S = this._gltfSlices;

    const neckY = b.backNeckHeight / 100;
    const topY = neckY + 0.015;
    const hemY = (R.length?.height_cm ?? R.hem?.height_cm ?? b.hipHeight) / 100;
    const bustY = b.bustHeight / 100;
    const armpitY = this.rings.armpitY ?? bustY - 0.04;

    // Radial ease (metres) at a height, from the chart circumference vs the body ring there.
    const chestC = chart.chest ? (2 * chart.chest) / 100 : null;
    const hemC = chart.hem ? (2 * chart.hem) / 100 : chestC;
    const easeAt = (Y) => {
      const Yc = Math.min(Y, bustY);
      const ring = ringAt(this.rings.torso, Yc);
      if (!ring) return MIN_GAP;
      let C = chestC;
      if (chestC && hemC && Y < bustY) {
        const t = (bustY - Y) / Math.max(0.01, bustY - hemY);
        C = chestC + (hemC - chestC) * Math.min(1, Math.max(0, t));
      }
      if (!C) return Math.max(MIN_GAP, cmEaseToRadius(R.chest?.ease_cm));
      return Math.max(MIN_GAP, (C - ringCircumference(ring)) / TWO_PI);
    };
    const tCache = new Map();
    const easeCached = (Y) => {
      const k = Math.round(Y * 200);
      let v = tCache.get(k);
      if (v === undefined) tCache.set(k, (v = easeAt(Y)));
      return v;
    };
    const bustEase = easeAt(bustY);

    // Torso below the armpit: point on the ring at Y by angle; below the chest never narrower
    // than the chest (cloth hangs).
    const shoulderY = neckY - 0.06;
    // Gravity: below the chest the cloth is never narrower than anything above it (it hangs).
    const hangTorso = hangingRings(this.rings.torso, bustY, hemY - 0.02);
    const torsoPoint = (Y, u, front) => {
      const theta = front ? Math.acos(u) : -Math.acos(u);
      const smp = sampleRing(this.rings.torso, Math.min(Y, shoulderY - 0.01), theta);
      if (!smp) return null;
      let r = smp.r + easeCached(Y) + 0.006;
      if (Y < bustY) {
        const hg = sampleRing(hangTorso, Y, theta);
        if (hg) r = Math.max(r, hg.r + bustEase + 0.006);
      }
      return [smp.cx + r * Math.cos(theta), smp.cz + r * Math.sin(theta)];
    };

    // Shoulders / collar above the armpit: a shirt sits ON the shoulders, so keep the mesh's own
    // shape there, scaled so its chest band matches the body's chest (+ ease) and centred on it.
    const vBust = clamp((bustY - hemY) / Math.max(0.01, topY - hemY), 0, 1);
    const msBust = lerpStats(S.all, vBust, NB) ?? S.nearestAll(Math.floor(vBust * NB));
    const bustRing = ringAt(this.rings.torso, bustY);
    const extBust = ringExtent(bustRing) ?? { xmin: -0.17, xmax: 0.17, zmin: -0.12, zmax: 0.1 };
    const upSx = ((extBust.xmax - extBust.xmin) / 2 + bustEase + 0.006) / msBust.hw;
    const upSz = ((extBust.zmax - extBust.zmin) / 2 + bustEase + 0.006) / msBust.hd;
    const upCx = (extBust.xmin + extBust.xmax) / 2;
    const upCz = (extBust.zmin + extBust.zmax) / 2;
    const upperPoint = (x, z) => [upCx + (x - msBust.cx) * upSx, upCz + (z - msBust.cz) * upSz];
    // ring-wrap up to the shoulder line; the mesh's own (scaled) shape only for the collar zone
    const blendLo = shoulderY - 0.05;
    const blendHi = shoulderY;

    // Sleeves: tube along the arm from the shoulder point, radius from the chart's arm width.
    const sleeveLen = (chart.sleeve ?? 20) / 100;
    const armR = chart.arm_width ? (2 * chart.arm_width) / 100 / TWO_PI : (b.upperArmGirthR ?? 30) / 100 / TWO_PI + 0.015;
    const arms = {};
    for (const side of ['R', 'L']) {
      const a = this.arms?.[side];
      if (!a) continue;
      // arm axis starts a little below the shoulder top (the joint), not on it
      const Sx = a.shoulder.x;
      const Sy = a.shoulder.y - 0.03;
      const Sz = a.shoulder.z;
      let dx = a.hand.x - Sx;
      let dy = a.hand.y - Sy;
      let dz = a.hand.z - Sz;
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;
      // perpendicular in the x-y plane pointing outward/up
      let nx = -dy;
      let ny = dx;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl;
      ny /= nl;
      if (nx * Math.sign(Sx) < 0) {
        nx = -nx;
        ny = -ny;
      }
      arms[side] = { Sx, Sy, Sz, dx, dy, dz, nx, ny };
    }
    // Half sleeve width as a fraction of sleeve length (flat width = chart arm width).
    const sleeveHalfM = chart.arm_width ? chart.arm_width / 200 : armR * 1.6;
    const sleeveHalfN = sleeveHalfM / Math.max(0.05, sleeveLen);
    // A sleeve rests on top of the arm and its slack hangs underneath: the tube's centre is
    // pushed down/inward so its top surface touches the arm.
    const armBodyR = (b.upperArmGirthR ?? 30) / 100 / TWO_PI;
    const sleevePoint = (side, s, u, front) => {
      const A = arms[side];
      if (!A) return null;
      const phi = front ? Math.acos(u) : -Math.acos(u);
      const along = s * sleeveLen;
      const r = Math.max(armBodyR + 0.008, armR * (1 - 0.12 * s));
      const drop = r - (armBodyR + 0.008); // slack hangs under the arm
      const px = A.Sx + A.dx * along - A.nx * drop;
      const py = A.Sy + A.dy * along - A.ny * drop;
      const pz = A.Sz + A.dz * along;
      return [px + r * Math.cos(phi) * A.nx, py + r * Math.cos(phi) * A.ny, pz + r * Math.sin(phi)];
    };

    model.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry;
      const orig = o.userData.origPos;
      const pos = geo.attributes.position;
      const out = pos.array;
      const n = pos.count;
      for (let i = 0; i < n; i++) {
        const x = orig[i * 3];
        const y = orig[i * 3 + 1];
        const z = orig[i * 3 + 2];
        const v = Math.min(0.9999, Math.max(0, (y - box.min.y) / h));
        let p = null;
        // Sleeve vertex? (position along/across the sleeve's own axis in the flat mesh)
        const sv = S.sleeveOf(x, y, z);
        const ax = Math.abs(x - meshCx);
        if (sv || ax > S.torsoHalf) {
          // sleeve, or the underarm gusset beside it (tucked to the sleeve's underarm root)
          const side = x >= meshCx ? 'R' : 'L';
          const q = sv ? sleevePoint(sv.side, sv.s, sv.u, sv.front) : sleevePoint(side, 0.02, -1, z >= (S.frames[side]?.zc ?? 0));
          if (q) {
            out[i * 3] = q[0];
            out[i * 3 + 1] = q[1];
            out[i * 3 + 2] = q[2];
            continue;
          }
        }
        const band = Math.floor(v * NB);
        const ms = lerpStats(S.all, v, NB) ?? S.nearestAll(band);
        const Y = hemY + v * (topY - hemY);
        // across the torso: normalised by the constant torso width (the flat torso is a rectangle),
        // so the mapping is smooth from hem to shoulder
        const u = clamp((x - meshCx) / S.torsoHalf, -1, 1);
        const pr = Y < blendHi ? torsoPoint(Y, u, z >= ms.cz) : null;
        const pu = Y > blendLo ? upperPoint(x, z) : null;
        if (pr && pu) {
          const t = clamp((Y - blendLo) / (blendHi - blendLo), 0, 1);
          p = [pr[0] + (pu[0] - pr[0]) * t, pr[1] + (pu[1] - pr[1]) * t];
        } else p = pr ?? pu;
        let Yd = Y;
        if (p && Y > armpitY && this.shoulderMap) {
          // drape: cloth above the armpit rests ON the shoulders, never inside them
          const top = this.shoulderMap.lookup(p[0], p[1]);
          if (top != null) Yd = Math.max(Y, Math.min(top + 0.008, Y + 0.05));
        }
        out[i * 3] = p ? p[0] : x;
        out[i * 3 + 1] = Yd;
        out[i * 3 + 2] = p ? p[1] : z;
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      if (window.__debugTop) {
        const samples = [];
        for (let i = 0; i < n && samples.length < 12; i += 977) {
          const ax = Math.abs(orig[i * 3] - meshCx);
          if (ax > S.torsoHalf) samples.push({ in: [orig[i * 3], orig[i * 3 + 1], orig[i * 3 + 2]].map((v) => +v.toFixed(3)), out: [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]].map((v) => +v.toFixed(3)) });
        }
        this.debugTop = { torsoHalf: S.torsoHalf, sleeveLen: S.sleeveLen, maxAx: S.torsoHalf + S.sleeveLen, box: [box.min.toArray(), box.max.toArray()], arms, sleeveLenM: sleeveLen, armR, cols: S.sleeves.R.map((c) => c && { yc: +c.yc.toFixed(3), yh: +c.yh.toFixed(3), zc: +c.zc.toFixed(3) }), samples, armpitY, bustY, hemY, topY, upSx, upSz };
      }
    });
    model.position.set(0, 0, 0);
    model.scale.set(1, 1, 1);
  }

  /**
   * Reshape a flat-lay trousers mesh onto the body. Every vertex is remapped by its height band:
   * above the mesh's crotch the band wraps the torso (width from the chart's waist/hip
   * circumference, depth from the body); below it each leg wraps the corresponding body leg,
   * straight from the thigh down. Sealed hems are cut open. Writes absolute positions.
   */
  _deformBottoms(model, box, R, chart) {
    const b = this.body;
    const NB = 64;
    const h = box.max.y - box.min.y || 1;
    const meshCx = (box.min.x + box.max.x) / 2;

    // Per-band mesh statistics (once per mesh).
    if (!this._gltfSlices) this._gltfSlices = sliceMesh(model, box, NB, meshCx);
    const S = this._gltfSlices;

    // Body targets.
    const crotchY = b.insideLegHeight / 100;
    const topY = (R.waist?.height_cm ?? b.waistHeight) / 100;
    // Where the hem wants to be: the outseam down from where the waistband is worn (a long rise
    // worn lower means a lower crotch and a lower hem, as in real life).
    const hemWanted = chart.total_length != null ? topY - chart.total_length / 100 : crotchY - (effectiveInseam(chart) ?? b.insideLegHeight) / 100;
    // Hem never goes below the ankle: a too-long leg bunches on the shoe rather than covering the foot.
    const hemY = Math.max((b.outerAnkleHeightR ?? 7) / 100 + 0.005, hemWanted);
    const kneeY = (b.kneeHeightR ?? 48) / 100;
    const midThighY = (crotchY + kneeY) / 2;
    const hipY = b.hipHeight / 100;
    // Pooling: a leg longer than the wearer's bunches up at the ankle instead of vanishing.
    const excess = Math.max(0, hemY - hemWanted); // metres of leg that has nowhere to go
    const POOL = 0.08;
    const easeHip = Math.max(MIN_GAP, cmEaseToRadius(R.hip?.ease_cm ?? R.waist?.ease_cm));
    const easeWaist = Math.max(MIN_GAP, cmEaseToRadius(R.waist?.ease_cm ?? R.hip?.ease_cm));
    const legEase = Math.max(MIN_GAP, cmEaseToRadius(R.thigh?.ease_cm ?? R.hip?.ease_cm) + 0.004);
    const waistC = chart.waist ? (2 * chart.waist) / 100 : null;
    const hipC = chart.hip ? (2 * chart.hip) / 100 : null;

    const thighExt = { R: ringExtent(ringAt(this.rings.right, midThighY)), L: ringExtent(ringAt(this.rings.left, midThighY)) };
    const legTop = this.rings.legTopY || crotchY;

    const torsoTarget = (Y) => {
      let ring = ringAt(this.rings.torso, Math.max(Y, legTop));
      const ext = ringExtent(ring);
      const ease = Y > hipY ? easeWaist : easeHip;
      const td = ext ? (ext.zmax - ext.zmin) / 2 + ease + 0.01 : 0.12;
      // chart circumference at this height: waist at the top, hip at hip height, hip below
      let C = null;
      if (waistC && hipC) {
        const t = Math.min(1, Math.max(0, (Y - hipY) / Math.max(0.01, topY - hipY)));
        C = hipC + (waistC - hipC) * t;
      } else C = waistC ?? hipC;
      let tw = ext ? (ext.xmax - ext.xmin) / 2 + ease : 0.18;
      if (C) tw = Math.max(tw, Math.sqrt(Math.max(0, 2 * (C / TWO_PI) ** 2 - td * td)));
      return { cx: ext ? (ext.xmin + ext.xmax) / 2 : 0, cz: ext ? (ext.zmin + ext.zmax) / 2 : 0, tw, td };
    };
    const legTarget = (side, Y) => {
      const rings = side === 'R' ? this.rings.right : this.rings.left;
      const ring = ringAt(rings, Math.min(Y, legTop - 0.005));
      const ext = ringExtent(ring);
      if (!ext) return null;
      const th = thighExt[side] ?? ext;
      // straight leg: never narrower than the thigh
      const tw = Math.max(ext.xmax - ext.xmin, th.xmax - th.xmin) / 2 + legEase;
      const td = Math.max(ext.zmax - ext.zmin, th.zmax - th.zmin) / 2 + legEase;
      return { cx: (ext.xmin + ext.xmax) / 2, cz: (ext.zmin + ext.zmax) / 2, tw, td };
    };

    model.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry;
      const orig = o.userData.origPos;
      const pos = geo.attributes.position;
      const out = pos.array;
      const n = pos.count;
      // Body targets are cached per 5 mm of height so the loop stays cheap and smooth.
      const tCache = new Map();
      const cached = (key, fn) => {
        let v = tCache.get(key);
        if (v === undefined) tCache.set(key, (v = fn()));
        return v;
      };
      // Vertical mapping: mesh hem -> body hem, mesh crotch -> the height where the body's legs
      // split, mesh top -> waistband. Piecewise so leg geometry never wraps the torso.
      const vCrotch = S.crotchBand >= 0 ? (S.crotchBand + 1) / NB : null;
      // Legs run from the wanted hem (may be below the ankle) to the split; the part below the
      // ankle is squashed into an 8 cm pool just above the hem, flaring out a little.
      const legBottom = hemWanted;
      const mapYLeg = (v) => {
        const Yl = legBottom + (v / (vCrotch ?? 1)) * (legTop - legBottom);
        if (excess <= 0 || Yl >= hemY + POOL) return { Y: Yl, bump: 0 };
        const t = clamp((Yl - legBottom) / (hemY + POOL - legBottom), 0, 1);
        // gentle stack of folds: a few mm out, more the longer the excess
        return { Y: hemY + t * POOL, bump: Math.min(0.02, excess * 0.2) * Math.sin(Math.PI * t) };
      };
      const mapY = (v) => {
        if (vCrotch == null) return hemY + v * (topY - hemY);
        if (v <= vCrotch) return mapYLeg(v).Y;
        return legTop + ((v - vCrotch) / (1 - vCrotch)) * (topY - legTop);
      };
      // Each vertex is placed by ANGLE on the body's own cross-section ring at its height:
      // its position across the flat garment (u = -1..1) becomes an angle, front layer on the
      // front half of the ring, back layer on the back half. The ring is pushed out by the ease
      // (legs) or scaled to the chart's circumference (hips/waist). A flat mesh thus becomes a
      // real tube that follows the body instead of a lens with thin edges.
      const splitY = this.rings.crotchSplitY ?? crotchY;
      // Gravity: legs hang straight from their widest point (upper thigh); the seat likewise
      // down to the crotch. Cloth only follows the body where the body is wider than the cloth.
      const legRings = {
        R: hangingRings(this.rings.right, legTop - 0.005, hemY - 0.02),
        L: hangingRings(this.rings.left, legTop - 0.005, hemY - 0.02),
      };
      const hangTorso = hangingRings(this.rings.torso, hipY, splitY - 0.01);
      const BLEND = 0.06; // metres below the crotch where legs blend into the hip mapping
      const chartC = (Y) => {
        if (waistC && hipC) {
          const t = Math.min(1, Math.max(0, (Y - hipY) / Math.max(0.01, topY - hipY)));
          return hipC + (waistC - hipC) * t;
        }
        return waistC ?? hipC ?? null;
      };
      // Hip/waist target for a vertex: point on the torso ring (smoothly sampled) pushed out by
      // the ease or scaled to the chart circumference, whichever is larger.
      const torsoPoint = (Y, u, front, yk) => {
        const t = cached('T' + yk, () => {
          const Yc = Math.max(Y, splitY);
          const ring = ringAt(this.rings.torso, Yc);
          if (!ring) return null;
          const C = chartC(Y);
          return { Yc, s: C ? C / ringCircumference(ring) : 1, ease: Y > hipY ? easeWaist : easeHip };
        });
        if (!t) return null;
        const theta = front ? Math.acos(u) : -Math.acos(u);
        const smp = sampleRing(this.rings.torso, t.Yc, theta);
        if (!smp) return null;
        let r = Math.max(smp.r + t.ease, smp.r * t.s);
        if (Y < hipY) {
          const hg = sampleRing(hangTorso, t.Yc, theta);
          if (hg) r = Math.max(r, hg.r * t.s, hg.r + t.ease);
        }
        return [smp.cx + r * Math.cos(theta), smp.cz + r * Math.sin(theta)];
      };
      // Leg target: point on the hanging profile of that leg (straight from the widest point) + ease.
      const legPoint = (side, Y, u, front, bump = 0) => {
        const theta = front ? Math.acos(u) : -Math.acos(u);
        const smp = sampleRing(legRings[side], Math.min(Y, legTop - 0.005), theta);
        if (!smp) return null;
        const r = smp.r + legEase + bump;
        return [smp.cx + r * Math.cos(theta), smp.cz + r * Math.sin(theta)];
      };
      for (let i = 0; i < n; i++) {
        const x = orig[i * 3];
        const y = orig[i * 3 + 1];
        const z = orig[i * 3 + 2];
        const v = Math.min(0.9999, Math.max(0, (y - box.min.y) / h));
        const band = Math.floor(v * NB);
        const Y = mapY(v);
        const yk = Math.round(Y * 200); // 5 mm buckets
        const ms = lerpStats(S.all, v, NB) ?? S.nearestAll(band);
        const uAll = clamp((x - ms.cx) / ms.hw, -1, 1);
        const frontAll = z >= ms.cz;
        let p = null;
        if (band <= S.crotchBand) {
          const side = x >= meshCx ? 'R' : 'L';
          const ls = lerpStats(S.legs[side], v, NB) ?? S.nearestLeg(side, band);
          if (ls) {
            const u = clamp((x - ls.cx) / ls.hw, -1, 1);
            const pool = vCrotch != null ? mapYLeg(v).bump : 0;
            p = legPoint(side, Y, u, z >= ls.cz, pool);
            // blend into the hip mapping just below the crotch so there is no shelf
            if (p && Y > legTop - BLEND) {
              const q = torsoPoint(Y, uAll, frontAll, yk);
              if (q) {
                const t = (Y - (legTop - BLEND)) / BLEND;
                p = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
              }
            }
          }
        }
        if (!p) p = torsoPoint(Y, uAll, frontAll, yk);
        out[i * 3] = p ? p[0] : x;
        out[i * 3 + 1] = Y;
        out[i * 3 + 2] = p ? p[1] : z;
      }
      pos.needsUpdate = true;
      // debug: per-2cm extents of the deformed right half + the targets used
      if (window.__debugBottoms) {
        const rows = new Map();
        for (let i = 0; i < n; i++) {
          const Y = out[i * 3 + 1];
          const k = Math.round(Y * 50) / 50;
          const r = rows.get(k) ?? { Y: k, xmin: Infinity, xmax: -Infinity, zmin: Infinity, zmax: -Infinity, n: 0 };
          const X = out[i * 3];
          if (X >= 0) {
            r.xmin = Math.min(r.xmin, X);
            r.xmax = Math.max(r.xmax, X);
            r.zmin = Math.min(r.zmin, out[i * 3 + 2]);
            r.zmax = Math.max(r.zmax, out[i * 3 + 2]);
            r.n++;
          }
          rows.set(k, r);
        }
        this.debugBottoms = {
          legTop, crotchY, hemY, topY, hipY, crotchBand: S.crotchBand, vCrotch, legEase, easeHip,
          rows: [...rows.values()].sort((a, b) => a.Y - b.Y).map((r) => ({
            ...r,
            torso: torsoTarget(r.Y),
            legR: legTarget('R', r.Y),
            bodyTorso: ringExtent(ringAt(this.rings.torso, r.Y)),
            bodyLegR: ringExtent(ringAt(this.rings.right, r.Y)),
          })),
        };
      }
      // cut the sealed hem open: drop faces entirely within the bottom 1.5 % of the mesh
      if (!o.userData.hemCut) {
        openBottom(geo, orig, box.min.y + h * 0.015);
        o.userData.hemCut = true;
      }
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
    });
    model.position.set(0, 0, 0);
    model.scale.set(1, 1, 1);
  }

  /** x/z extent of the body rings between two heights (metres). */
  _bodyExtent(ringMaps, yBottom, yTop) {
    let xmin = Infinity;
    let xmax = -Infinity;
    let zmin = Infinity;
    let zmax = -Infinity;
    for (const rings of ringMaps) {
      for (const ring of rings.values()) {
        if (ring.y < yBottom || ring.y > yTop) continue;
        for (let j = 0; j < RING_BINS; j++) {
          const ang = (j / RING_BINS) * TWO_PI - Math.PI;
          const x = ring.cx + ring.r[j] * Math.cos(ang);
          const z = ring.cz + ring.r[j] * Math.sin(ang);
          if (x < xmin) xmin = x;
          if (x > xmax) xmax = x;
          if (z < zmin) zmin = z;
          if (z > zmax) zmax = z;
        }
      }
    }
    return Number.isFinite(xmin) ? { xmin, xmax, zmin, zmax } : null;
  }

  /** 'look' = photo-real mesh, 'fit' = measured shell coloured by fit, 'both' = ghosted mesh over the coloured shell. */
  setMode(mode) {
    this.mode = mode;
    const hasMesh = this.meshyGroup.children.length > 0;
    this.meshyGroup.visible = hasMesh && mode !== 'fit';
    this.garmentGroup.visible = !hasMesh || mode !== 'look';
    const ghost = hasMesh && mode === 'both';
    for (const m of this._meshMaterials ?? []) {
      m.transparent = ghost;
      m.opacity = ghost ? 0.35 : 1;
      m.depthWrite = !ghost;
      m.needsUpdate = true;
    }
    shellMaterial.opacity = 0.94;
  }

  get hasGarmentModel() {
    return this.meshyGroup.children.length > 0;
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

    // Cloth hangs straight down from the chest rather than following the waist curve;
    // a crew neck dips ~7 cm at the front.
    const mesh = ringsToMesh(this.rings.torso, hemY, topY, anchors, { hangFromY: b.bustHeight / 100, neckDip: 0.07 });
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
    const waistbandY = (R.waist?.height_cm ?? waistbandHeight(chart, b)) / 100;
    const ankleY = (b.outerAnkleHeightR ?? 7) / 100 + 0.01;
    // Hem never goes below the ankle: a too-long leg bunches on the shoe rather than covering the foot.
    const hemY = Math.max(ankleY, crotchY - (effectiveInseam(chart) ?? b.insideLegHeight) / 100);
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

    // legs: hem -> split. Coloured by width (thigh, else hip) — the leg *length* is shown by
    // where the hem stops, not by colour. Below the thigh the fabric hangs straight down.
    const legColor = col(R.thigh?.verdict ?? R.hip?.verdict ?? 'good');
    const legAnchors = [
      { y: hemY, delta: thighDelta, color: legColor },
      { y: midThighY, delta: thighDelta, color: legColor },
      { y: splitY, delta: hipDelta, color: col(R.hip?.verdict ?? 'good') },
    ].sort((a, c) => a.y - c.y);
    for (const rings of [this.rings.right, this.rings.left]) {
      const m = ringsToMesh(rings, hemY, splitY + 0.012, legAnchors, { hangFromY: midThighY });
      if (m) this.garmentGroup.add(m);
    }
  }
}

// ---------- helpers ----------
/** Bake node transforms into float32 positions and keep an untouched copy per mesh. */
function bakeToWorld(scene) {
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((o) => {
    if (o.isMesh) meshes.push(o);
  });
  for (const o of meshes) {
    const src = o.geometry.attributes.position;
    const arr = new Float32Array(src.count * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < src.count; i++) {
      v.fromBufferAttribute(src, i).applyMatrix4(o.matrixWorld);
      arr[i * 3] = v.x;
      arr[i * 3 + 1] = v.y;
      arr[i * 3 + 2] = v.z;
    }
    o.geometry.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    o.userData.origPos = Float32Array.from(arr);
    // Quantized (int16) normals can't hold recomputed floats; rebuild them as float32.
    o.geometry.deleteAttribute('normal');
    o.geometry.deleteAttribute('tangent');
    o.geometry.computeVertexNormals();
    // Which layer of the flat-lay garment a vertex belongs to (front layer faces +z, back layer
    // faces -z). Use the surface normal where it clearly faces front/back; elsewhere (hem strips,
    // folds) compare the vertex to the local mid-surface between the two layers.
    const nrm = o.geometry.attributes.normal;
    const front = new Uint8Array(nrm.count);
    const bb = o.geometry.boundingBox;
    const cell = Math.max(1e-3, (bb.max.x - bb.min.x) / 60);
    const gx = Math.ceil((bb.max.x - bb.min.x) / cell) + 1;
    const gy = Math.ceil((bb.max.y - bb.min.y) / cell) + 1;
    const sumZ = new Float64Array(gx * gy);
    const minZ = new Float32Array(gx * gy).fill(Infinity);
    const maxZ = new Float32Array(gx * gy).fill(-Infinity);
    const cnt = new Uint32Array(gx * gy);
    const cellOf = (x, y) => Math.floor((y - bb.min.y) / cell) * gx + Math.floor((x - bb.min.x) / cell);
    for (let i = 0; i < nrm.count; i++) {
      const k = cellOf(arr[i * 3], arr[i * 3 + 1]);
      const z = arr[i * 3 + 2];
      sumZ[k] += z;
      cnt[k]++;
      if (z < minZ[k]) minZ[k] = z;
      if (z > maxZ[k]) maxZ[k] = z;
    }
    // Back layer = vertices close to the back surface of the flat-lay; everything else is front
    // cloth, including recessed detail on the front (a fly slot, pocket edges) whose normals
    // face sideways or backwards. Where the layers meet (edges) the normal decides.
    for (let i = 0; i < nrm.count; i++) {
      const k = cellOf(arr[i * 3], arr[i * 3 + 1]);
      const thick = maxZ[k] - minZ[k];
      const nz = nrm.getZ(i);
      // back = near the back surface AND facing backwards; a recessed front detail (the fly
      // slot runs as deep as the back layer at the crotch) faces forwards or sideways
      if (nz > 0.3) front[i] = 1;
      else if (nz < -0.3) front[i] = thick > 1e-4 && arr[i * 3 + 2] - minZ[k] > 0.3 * thick ? 1 : 0;
      else front[i] = arr[i * 3 + 2] >= sumZ[k] / Math.max(1, cnt[k]) ? 1 : 0; // edges: by the mid-surface
    }
    // majority vote over the neighbours: no isolated flips (they would stretch a triangle
    // from the front of the body to the back)
    const adj = buildAdjacency(o.geometry);
    o.userData.adj = adj;
    for (let round = 0; round < 2; round++) {
      const next = Uint8Array.from(front);
      for (let i = 0; i < nrm.count; i++) {
        const c = adj.canon[i];
        const s = adj.offsets[c];
        const e = adj.offsets[c + 1];
        if (e - s < 3) continue;
        let votes = front[i];
        for (let j = s; j < e; j++) votes += front[adj.list[j]];
        next[i] = votes * 2 > e - s + 1 ? 1 : 0;
      }
      front.set(next);
    }
    o.userData.origFront = front;
    // depth fraction across the flat-lay thickness (0 = back surface, 1 = front): lets the
    // rounded side edges wrap smoothly round the body instead of snapping front/back
    const depthF = new Float32Array(nrm.count);
    for (let i = 0; i < nrm.count; i++) {
      const k = cellOf(arr[i * 3], arr[i * 3 + 1]);
      const thick = maxZ[k] - minZ[k];
      depthF[i] = thick > 1e-4 ? clamp((arr[i * 3 + 2] - minZ[k]) / thick, 0, 1) : front[i];
    }
    o.userData.origDepth = depthF;
    // the same, smoothed over the mesh (a bumpy back layer must not flip individual vertices)
    {
      let cur = Float32Array.from(depthF);
      let nxt = new Float32Array(depthF.length);
      for (let it = 0; it < 10; it++) {
        for (let i = 0; i < nrm.count; i++) {
          const c = adj.canon[i];
          const s0 = adj.offsets[c];
          const e = adj.offsets[c + 1];
          if (e === s0) { nxt[i] = cur[i]; continue; }
          let sum = 0;
          for (let j = s0; j < e; j++) sum += cur[adj.list[j]];
          nxt[i] = 0.5 * cur[i] + (0.5 * sum) / (e - s0);
        }
        const t = cur;
        cur = nxt;
        nxt = t;
      }
      o.userData.origDepthS = cur;
    }
    o.geometry.computeBoundingBox();
    o.geometry.computeBoundingSphere();
  }
  scene.traverse((o) => {
    o.position.set(0, 0, 0);
    o.quaternion.identity();
    o.scale.set(1, 1, 1);
  });
  scene.updateMatrixWorld(true);
}

/** Absolute x/z extent of one body ring. */
function ringExtent(ring) {
  if (!ring) return null;
  let xmin = Infinity;
  let xmax = -Infinity;
  let zmin = Infinity;
  let zmax = -Infinity;
  for (let j = 0; j < RING_BINS; j++) {
    const ang = (j / RING_BINS) * TWO_PI - Math.PI;
    const x = ring.cx + ring.r[j] * Math.cos(ang);
    const z = ring.cz + ring.r[j] * Math.sin(ang);
    if (x < xmin) xmin = x;
    if (x > xmax) xmax = x;
    if (z < zmin) zmin = z;
    if (z > zmax) zmax = z;
  }
  return { xmin, xmax, zmin, zmax };
}

/**
 * Per-height-band statistics of a trousers mesh: overall and per leg (split at the mesh centre
 * line), plus the band where the two legs join (crotch): the highest band with no vertices near
 * the centre line.
 */
function sliceMesh(scene, box, NB, meshCx) {
  const h = box.max.y - box.min.y || 1;
  const w = box.max.x - box.min.x || 1;
  const mk = () => ({ xs: [], zs: [] });
  const all = Array.from({ length: NB }, mk);
  const legs = { R: Array.from({ length: NB }, mk), L: Array.from({ length: NB }, mk) };
  const gapHW = new Float32Array(NB).fill(Infinity); // nearest vertex to the centre line per band
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.userData.origPos;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      const y = p[i + 1];
      const z = p[i + 2];
      const band = Math.min(NB - 1, Math.max(0, Math.floor(((y - box.min.y) / h) * NB)));
      for (const s of [all[band], legs[x >= meshCx ? 'R' : 'L'][band]]) {
        s.xs.push(x);
        s.zs.push(z);
      }
      const ax = Math.abs(x - meshCx);
      if (ax < gapHW[band]) gapHW[band] = ax;
    }
  });
  // Use percentiles, not extremes: the front of a flat-lay garment bulges (pockets, fly) while
  // the back is flat, so the true back surface is well inside the raw z-range.
  const pct = (arr, q) => {
    arr.sort((a, b) => a - b);
    return arr[Math.min(arr.length - 1, Math.max(0, Math.floor(q * (arr.length - 1))))];
  };
  const finish = (s) => {
    if (s.xs.length < 6) return null;
    const xlo = pct(s.xs, 0.01);
    const xhi = pct(s.xs, 0.99);
    const zlo = pct(s.zs, 0.04);
    const zhi = pct(s.zs, 0.96);
    return { cx: (xlo + xhi) / 2, cz: (zlo + zhi) / 2, hw: Math.max(1e-3, (xhi - xlo) / 2), hd: Math.max(1e-3, (zhi - zlo) / 2) };
  };
  const out = {
    all: all.map(finish),
    legs: { R: legs.R.map(finish), L: legs.L.map(finish) },
    crotchBand: -1,
  };
  // crotch = highest band (below the top third) with a real gap between the legs. Generated
  // meshes often carry a narrow crevice above the crotch (the fly); that is seat, not legs.
  for (let bnd = Math.floor(NB * 0.66); bnd >= 0; bnd--) {
    if (gapHW[bnd] > w * 0.03) {
      out.crotchBand = bnd;
      break;
    }
  }
  out.gapHW = Array.from(gapHW);
  // legs may be fused (photo with legs together): then there is no leg region
  if (out.crotchBand < 2) out.crotchBand = -1;
  out.nearestLeg = (side, band) => {
    for (let d = 1; d < NB; d++) {
      if (out.legs[side][band - d]) return out.legs[side][band - d];
      if (out.legs[side][band + d]) return out.legs[side][band + d];
    }
    return null;
  };
  out.nearestAll = (band) => {
    for (let d = 1; d < NB; d++) {
      if (out.all[band - d]) return out.all[band - d];
      if (out.all[band + d]) return out.all[band + d];
    }
    return { cx: meshCx, cz: 0, hw: w / 2, hd: 0.05 };
  };
  return out;
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / Math.max(1e-9, b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Shape facts about a flat-lay top mesh (its own units): torso half-width below the sleeves,
 * hem half-width, depth, where the sleeves start (armpit height as a 0..1 fraction), and the
 * widest point (sleeve tip).
 */
function topProfile(scene, box, meshCx, bands) {
  const h = box.max.y - box.min.y || 1;
  const NB = 48;
  const maxAx = new Float32Array(NB);
  let maxAll = 0;
  scene.traverse((o) => {
    if (!o.isMesh || !o.userData.origPos) return;
    const p = o.userData.origPos;
    for (let i = 0; i < p.length; i += 3) {
      const band = Math.min(NB - 1, Math.max(0, Math.floor(((p[i + 1] - box.min.y) / h) * NB)));
      const ax = Math.abs(p[i] - meshCx);
      if (ax > maxAx[band]) maxAx[band] = ax;
      if (ax > maxAll) maxAll = ax;
    }
  });
  const hemHW = bands.bottom.width > 0 ? bands.bottom.width / 2 : (box.max.x - box.min.x) / 4;
  const lo = Math.floor(NB * 0.15);
  let jump = Math.round(NB * 0.7);
  for (let k = lo; k < NB; k++) {
    if (maxAx[k] > hemHW * 1.2) {
      jump = k;
      break;
    }
  }
  // torso half-width: the median of the bands clearly below the sleeves (the sleeve underside
  // slopes into the side seam, so the bands just under the jump already contain sleeve)
  const torsoBands = Array.from(maxAx.slice(lo, Math.max(lo + 1, jump - 2))).sort((a, b) => a - b);
  const torsoHW = torsoBands.length ? torsoBands[Math.floor(torsoBands.length / 2)] : hemHW;
  let armBand = jump;
  for (let k = lo; k < jump; k++) {
    if (maxAx[k] > torsoHW * 1.03) {
      armBand = k;
      break;
    }
  }
  const depth = bands.bottom.depth > 0.02 * h ? bands.bottom.depth : box.max.z - box.min.z || 1;
  return { hemHW, torsoHW, depth, vArmpit: clamp(armBand / NB, 0.4, 0.85), maxAx: maxAll, bands: Array.from(maxAx), armBand };
}

/**
 * Vertex neighbours of a mesh (CSR arrays), with vertices that share a position (UV seams)
 * merged into one canonical vertex so smoothing crosses those seams.
 */
function buildAdjacency(geo) {
  const pos = geo.attributes.position.array;
  const n = pos.length / 3;
  const canon = new Int32Array(n);
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos[i * 3] * 2000)},${Math.round(pos[i * 3 + 1] * 2000)},${Math.round(pos[i * 3 + 2] * 2000)}`;
    const c = seen.get(key);
    if (c === undefined) {
      seen.set(key, i);
      canon[i] = i;
    } else canon[i] = c;
  }
  const idx = geo.getIndex()?.array;
  const m = idx ? idx.length : n;
  const nb = new Array(n).fill(null);
  const add = (a, b) => {
    const ca = canon[a];
    const cb = canon[b];
    if (ca === cb) return;
    (nb[ca] ??= new Set()).add(cb);
    (nb[cb] ??= new Set()).add(ca);
  };
  for (let t = 0; t + 2 < m; t += 3) {
    const a = idx ? idx[t] : t;
    const b = idx ? idx[t + 1] : t + 1;
    const c = idx ? idx[t + 2] : t + 2;
    add(a, b);
    add(b, c);
    add(c, a);
  }
  const offsets = new Int32Array(n + 1);
  let total = 0;
  for (let i = 0; i < n; i++) {
    offsets[i] = total;
    if (nb[i]) total += nb[i].size;
  }
  offsets[n] = total;
  const list = new Int32Array(total);
  for (let i = 0; i < n; i++) {
    if (!nb[i]) continue;
    let k = offsets[i];
    for (const j of nb[i]) list[k++] = j;
  }
  return { canon, offsets, list };
}


/** Top of the arm's centre line: the shoulder point moved inboard and down by the arm radius. */
function armAxis(arm, armR) {
  const s = Math.sign(arm.shoulder.x) || 1;
  return { x: arm.shoulder.x - s * armR * 0.7, y: arm.shoulder.y - armR * 0.9, z: arm.shoulder.z };
}

/**
 * Shoulder tips from the scan silhouette: per side, the outermost 1 cm column (from the torso
 * centre outward) whose top surface is still within 9.5 cm of the neck base; beyond it the
 * surface drops steeply into the arm. Falls back to the across-back width if the scan is odd.
 */
function shoulderTipsFromScan(positions, neckY, armpitY, cx0, fallbackHalf) {
  const top = new Map();
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    if (y < armpitY - 0.02 || y > neckY + 0.02) continue;
    const k = Math.round(positions[i] * 100);
    if (!top.has(k) || y > top.get(k)) top.set(k, y);
  }
  const thr = neckY - 0.095;
  const out = {};
  // top-of-body height along x (1 cm columns), for the yoke to follow
  out.profile = (x) => {
    const f = x * 100;
    const k0 = Math.floor(f);
    const t = f - k0;
    const a = top.get(k0);
    const b = top.get(k0 + 1);
    if (a == null && b == null) return null;
    if (a == null) return b;
    if (b == null) return a;
    return a + (b - a) * t;
  };
  for (const [side, sgn] of [['R', 1], ['L', -1]]) {
    let k = Math.round(cx0 * 100);
    let last = null;
    for (let n = 0; n < 40; n++, k += sgn) {
      const t = top.get(k);
      if (t == null || t < thr) break;
      last = { k, t };
    }
    const ok = last && Math.abs(last.k / 100 - cx0) > 0.1;
    out[side] = ok ? { x: last.k / 100 + sgn * 0.005, y: Math.min(last.t, neckY - 0.05) } : { x: cx0 + sgn * fallbackHalf, y: neckY - 0.07 };
  }
  return out;
}

/** Top-of-body height map (max y per 1 cm x/z cell) for vertices with yMin <= y <= yMax. */
function buildTopMap(positions, yMin, yMax) {
  const cell = 0.01;
  const x0 = -0.5;
  const z0 = -0.4;
  const nx = 100;
  const nz = 80;
  const data = new Float32Array(nx * nz).fill(-Infinity);
  for (let i = 0; i < positions.length; i += 3) {
    const y = positions[i + 1];
    if (y < yMin || y > yMax) continue;
    const ix = Math.floor((positions[i] - x0) / cell);
    const iz = Math.floor((positions[i + 2] - z0) / cell);
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
    const k = iz * nx + ix;
    if (y > data[k]) data[k] = y;
  }
  // Fill 1-cell holes so the surface is continuous, then sample bilinearly (no 1 cm steps).
  const filled = Float32Array.from(data);
  for (let iz = 1; iz < nz - 1; iz++) {
    for (let ix = 1; ix < nx - 1; ix++) {
      const k = iz * nx + ix;
      if (Number.isFinite(data[k])) continue;
      let sum = 0;
      let cnt = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const v = data[(iz + dz) * nx + ix + dx];
        if (Number.isFinite(v)) { sum += v; cnt++; }
      }
      if (cnt >= 3) filled[k] = sum / cnt;
    }
  }
  const at = (ix, iz) => (ix < 0 || iz < 0 || ix >= nx || iz >= nz ? -Infinity : filled[iz * nx + ix]);
  return {
    lookup(x, z) {
      const fx = (x - x0) / cell - 0.5;
      const fz = (z - z0) / cell - 0.5;
      const ix = Math.floor(fx);
      const iz = Math.floor(fz);
      const tx = fx - ix;
      const tz = fz - iz;
      const v00 = at(ix, iz);
      const v10 = at(ix + 1, iz);
      const v01 = at(ix, iz + 1);
      const v11 = at(ix + 1, iz + 1);
      const vals = [v00, v10, v01, v11];
      const ws = [(1 - tx) * (1 - tz), tx * (1 - tz), (1 - tx) * tz, tx * tz];
      let sum = 0;
      let wsum = 0;
      for (let i = 0; i < 4; i++) if (Number.isFinite(vals[i])) { sum += vals[i] * ws[i]; wsum += ws[i]; }
      return wsum > 0.25 ? sum / wsum : null;
    },
  };
}

/**
 * "Hanging" rings: going down from yTop, each ring's radii are the running maximum of every
 * ring above it (fabric falls straight down from the widest point it passes). Returns a new
 * ring map for the range [yBottom, yTop].
 */
function hangingRings(ringsMap, yTop, yBottom) {
  const out = new Map();
  const iTop = Math.round(yTop / SLICE_STEP);
  const iBot = Math.max(0, Math.floor(yBottom / SLICE_STEP));
  let acc = null;
  for (let iy = iTop; iy >= iBot; iy--) {
    const ring = ringsMap.get(iy);
    if (!ring) {
      if (acc) out.set(iy, { y: iy * SLICE_STEP, cx: acc.cx, cz: acc.cz, r: acc.r });
      continue;
    }
    if (!acc) acc = { cx: ring.cx, cz: ring.cz, r: Float32Array.from(ring.r) };
    else {
      const r = new Float32Array(ring.r.length);
      for (let j = 0; j < r.length; j++) r[j] = Math.max(acc.r[j], ring.r[j]);
      acc = { cx: ring.cx, cz: ring.cz, r };
    }
    out.set(iy, { y: ring.y, cx: ring.cx, cz: ring.cz, r: acc.r });
  }
  return out;
}

/**
 * Smoothly sampled body ring: radius/centre interpolated between the two nearest 1 cm slices
 * and between the two nearest angular bins, so deformed meshes don't show the ring grid.
 */
function sampleRing(ringsMap, Y, theta) {
  const fy = Y / SLICE_STEP;
  const i0 = Math.floor(fy);
  const ty = fy - i0;
  const a = ringsMap.get(i0) ?? ringAt(ringsMap, Y);
  if (!a) return null;
  const b = ringsMap.get(i0 + 1) ?? a;
  const N = RING_BINS;
  const fb = ((theta + Math.PI) / TWO_PI) * N;
  let j0 = Math.floor(fb);
  const tj = fb - j0;
  j0 = ((j0 % N) + N) % N;
  const j1 = (j0 + 1) % N;
  const ra = a.r[j0] * (1 - tj) + a.r[j1] * tj;
  const rb = b.r[j0] * (1 - tj) + b.r[j1] * tj;
  return { r: ra * (1 - ty) + rb * ty, cx: a.cx * (1 - ty) + b.cx * ty, cz: a.cz * (1 - ty) + b.cz * ty };
}

/** Half-width per band, gaps filled from neighbours, 5-band median-smoothed. */
function smoothProfile(bands, NB) {
  const raw = new Array(NB).fill(null);
  for (let b = 0; b < NB; b++) raw[b] = bands[b]?.hw ?? null;
  for (let b = 0; b < NB; b++) {
    if (raw[b] != null) continue;
    for (let d = 1; d < NB; d++) {
      if (raw[b - d] != null) { raw[b] = raw[b - d]; break; }
      if (raw[b + d] != null) { raw[b] = raw[b + d]; break; }
    }
    if (raw[b] == null) raw[b] = 0.1;
  }
  const out = new Array(NB);
  for (let b = 0; b < NB; b++) {
    const w = [];
    for (let d = -2; d <= 2; d++) if (raw[b + d] != null) w.push(raw[b + d]);
    w.sort((x, y) => x - y);
    out[b] = w[Math.floor(w.length / 2)];
  }
  return out;
}

/** Band statistics interpolated between band centres (no stair-steps between bands). */
function lerpStats(arr, v, NB) {
  const f = v * NB - 0.5;
  const b0 = Math.max(0, Math.min(NB - 1, Math.floor(f)));
  const b1 = Math.min(NB - 1, b0 + 1);
  const t = Math.max(0, Math.min(1, f - b0));
  const s0 = arr[b0];
  const s1 = arr[b1];
  if (s0 && s1) {
    return {
      cx: s0.cx + (s1.cx - s0.cx) * t,
      cz: s0.cz + (s1.cz - s0.cz) * t,
      hw: s0.hw + (s1.hw - s0.hw) * t,
      hd: s0.hd + (s1.hd - s0.hd) * t,
    };
  }
  return s0 ?? s1 ?? null;
}

/**
 * Per-band statistics of a top mesh (torso columns only) plus per-column statistics of each
 * sleeve. The torso half-width is taken from the hem band; anything further out is sleeve.
 */
function sliceTopMesh(scene, box, NB, meshCx) {
  const h = box.max.y - box.min.y || 1;
  const pct = (arr, q) => {
    arr.sort((a, b) => a - b);
    return arr[Math.min(arr.length - 1, Math.max(0, Math.floor(q * (arr.length - 1))))];
  };
  // torso half-width from the bottom 12 % of the mesh
  const hemXs = [];
  let maxAx = 0;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.userData.origPos;
    for (let i = 0; i < p.length; i += 3) {
      const ax = Math.abs(p[i] - meshCx);
      if (ax > maxAx) maxAx = ax;
      if (p[i + 1] <= box.min.y + h * 0.12) hemXs.push(ax);
    }
  });
  const torsoHalf = hemXs.length ? pct(hemXs, 0.99) * 1.02 : (box.max.x - box.min.x) / 4;
  const sleeveLen = Math.max(0, maxAx - torsoHalf);

  const NC = 24;
  const mk = () => ({ xs: [], zs: [], ys: [] });
  const all = Array.from({ length: NB }, mk);
  const sleeves = { R: Array.from({ length: NC }, mk), L: Array.from({ length: NC }, mk) };
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.userData.origPos;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      const y = p[i + 1];
      const z = p[i + 2];
      const ax = Math.abs(x - meshCx);
      if (ax > torsoHalf && sleeveLen > 0) {
        const col = Math.min(NC - 1, Math.floor(((ax - torsoHalf) / sleeveLen) * NC));
        const s = sleeves[x >= meshCx ? 'R' : 'L'][col];
        s.ys.push(y);
        s.zs.push(z);
      } else {
        const band = Math.min(NB - 1, Math.max(0, Math.floor(((y - box.min.y) / h) * NB)));
        all[band].xs.push(x);
        all[band].zs.push(z);
      }
    }
  });
  const finishBand = (s) => {
    if (s.xs.length < 6) return null;
    const xlo = pct(s.xs, 0.01);
    const xhi = pct(s.xs, 0.99);
    const zlo = pct(s.zs, 0.04);
    const zhi = pct(s.zs, 0.96);
    return { cx: (xlo + xhi) / 2, cz: (zlo + zhi) / 2, hw: Math.max(1e-3, (xhi - xlo) / 2), hd: Math.max(1e-3, (zhi - zlo) / 2) };
  };
  const finishCol = (s) => {
    if (s.ys.length < 6) return null;
    const ylo = pct(s.ys, 0.03);
    const yhi = pct(s.ys, 0.97);
    const zlo = pct(s.zs, 0.04);
    const zhi = pct(s.zs, 0.96);
    return { yc: (ylo + yhi) / 2, yh: Math.max(1e-3, (yhi - ylo) / 2), zc: (zlo + zhi) / 2 };
  };
  const out = { torsoHalf, sleeveLen, all: all.map(finishBand), sleeves: { R: sleeves.R.map(finishCol), L: sleeves.L.map(finishCol) }, NC };
  // Sleeve axis per side: from the shoulder seam (top of the mesh just beyond the torso edge) to
  // the cuff centre (the far column). Sleeves in flat-lay photos hang diagonally, so we need this.
  out.frames = {};
  for (const side of ['R', 'L']) {
    const cols = out.sleeves[side];
    const first = cols.find(Boolean);
    let last = null;
    for (let i = cols.length - 1; i >= 0; i--) if (cols[i]) { last = cols[i]; break; }
    if (!first || !last || sleeveLen <= 0.01) continue;
    const sgn = side === 'R' ? 1 : -1;
    // axis through the sleeve's centre line: middle of the armhole edge -> middle of the cuff
    const seam = { x: meshCx + sgn * torsoHalf, y: first.yc };
    const cuff = { x: meshCx + sgn * (torsoHalf + sleeveLen * 0.97), y: last.yc };
    let ax = cuff.x - seam.x;
    let ay = cuff.y - seam.y;
    const L = Math.hypot(ax, ay) || 1;
    ax /= L;
    ay /= L;
    // perpendicular pointing up/outward (towards the sleeve's top edge)
    const px = sgn > 0 ? -ay : ay;
    const py = sgn > 0 ? ax : -ax;
    out.frames[side] = { seam, ax, ay, px, py, L, zc: (first.zc + last.zc) / 2 };
  }
  // Second pass: the sleeve's own width, measured along its axis. The top edge (95th percentile
  // across) is clean; the width comes from the middle of the sleeve, away from the torso.
  const NS = 16;
  for (const side of ['R', 'L']) {
    const F = out.frames[side];
    if (!F) continue;
    const bins = Array.from({ length: NS }, () => []);
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.userData.origPos;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i];
        if ((side === 'R') !== x >= meshCx) continue;
        if (Math.abs(x - meshCx) <= torsoHalf * 0.98) continue;
        const rx = x - F.seam.x;
        const ry = p[i + 1] - F.seam.y;
        const s = (rx * F.ax + ry * F.ay) / F.L;
        if (s < 0 || s >= 1) continue;
        bins[Math.floor(s * NS)].push((rx * F.px + ry * F.py) / F.L);
      }
    });
    const top = bins.map((b) => (b.length > 5 ? pct(b, 0.95) : null));
    const bot = bins.map((b) => (b.length > 5 ? pct(b, 0.05) : null));
    const widths = [];
    for (let k = Math.floor(NS * 0.45); k < Math.floor(NS * 0.85); k++) {
      const b = bins[k];
      if (b.length > 5) widths.push((pct(b, 0.95) - pct(b, 0.05)) / 2);
    }
    widths.sort((a, b) => a - b);
    const hw = widths.length ? widths[Math.floor(widths.length / 2)] : 0.15;
    F.hw = hw;
    F.top = top;
    F.bot = bot;
    const nearest = (arr, s, fallback) => {
      const k = Math.min(NS - 1, Math.max(0, Math.floor(s * NS)));
      for (let d = 0; d < NS; d++) {
        if (arr[k - d] != null) return arr[k - d];
        if (arr[k + d] != null) return arr[k + d];
      }
      return fallback;
    };
    F.topAt = (s) => nearest(top, s, hw);
    F.botAt = (s) => nearest(bot, s, -hw);
  }
  // Per-column sleeve edges (columns run horizontally from the side seam to the cuff): the
  // top/bottom of the sleeve in y and its mid-plane in z. Flat-lay sleeves slope, so every
  // column has its own centre; the armhole column is tall, the cuff column short.
  const NCOL = 24;
  out.colEdges = {};
  for (const side of ['R', 'L']) {
    const ys = Array.from({ length: NCOL }, () => []);
    const zs = Array.from({ length: NCOL }, () => []);
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.userData.origPos;
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i];
        if ((side === 'R') !== x >= meshCx) continue;
        const ax = Math.abs(x - meshCx);
        if (ax <= torsoHalf * 0.98) continue;
        const k = Math.min(NCOL - 1, Math.max(0, Math.floor(((ax - torsoHalf) / Math.max(1e-3, sleeveLen)) * NCOL)));
        ys[k].push(p[i + 1]);
        zs[k].push(p[i + 2]);
      }
    });
    const top = ys.map((a) => (a.length > 5 ? pct(a.slice(), 0.97) : null));
    const bot = ys.map((a) => (a.length > 5 ? pct(a.slice(), 0.03) : null));
    const zc = zs.map((a) => (a.length > 5 ? (pct(a.slice(), 0.05) + pct(a.slice(), 0.95)) / 2 : null));
    const fill = (arr) => {
      const o = arr.slice();
      for (let k = 0; k < NCOL; k++) {
        if (o[k] != null) continue;
        for (let d = 1; d < NCOL; d++) {
          if (arr[k - d] != null) { o[k] = arr[k - d]; break; }
          if (arr[k + d] != null) { o[k] = arr[k + d]; break; }
        }
      }
      return o;
    };
    out.colEdges[side] = { top: fill(top), bot: fill(bot), zc: fill(zc) };
  }
  const lerpCol = (arr, f) => {
    const k0 = Math.max(0, Math.min(NCOL - 1, Math.floor(f)));
    const k1 = Math.min(NCOL - 1, k0 + 1);
    const t = Math.max(0, Math.min(1, f - k0));
    const a = arr[k0];
    const b = arr[k1];
    if (a == null) return b;
    if (b == null) return a;
    return a + (b - a) * t;
  };
  // Sleeve test shared with the deformer: returns {side, s, u, front} or null.
  // s = fraction along the sleeve (side seam -> cuff), u = across it (-1 underarm, +1 top),
  // front = which layer. Everything beside the torso is sleeve unless it lies clearly below
  // the sleeve's underarm edge (then it is an underarm gusset).
  out.sleeveOf = (x, y, z, lenient = false) => {
    const ax = Math.abs(x - meshCx);
    if (ax <= torsoHalf * 0.98 || sleeveLen <= 0.01) return null;
    const side = x >= meshCx ? 'R' : 'L';
    const E = out.colEdges[side];
    if (!E) return null;
    const s = Math.max(0, Math.min(1, (ax - torsoHalf) / sleeveLen));
    const f = s * NCOL - 0.5;
    const top = lerpCol(E.top, f);
    const bot = lerpCol(E.bot, f);
    const zc = lerpCol(E.zc, f) ?? 0;
    if (top == null || bot == null) return null;
    const span = Math.max(1e-3, top - bot);
    if (y < bot - span * 0.15) return lenient ? { side, s, u: -1, front: z >= zc } : null; // below the sleeve: gusset
    return { side, s, u: Math.max(-1, Math.min(1, (2 * (y - bot)) / span - 1)), front: z >= zc };
  };
  // Torso band statistics over everything that is NOT sleeve (the widening upper torso beside
  // the sleeves must be part of the torso, or it collapses onto the side seam).
  const all2 = Array.from({ length: NB }, () => ({ xs: [], zs: [] }));
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.userData.origPos;
    for (let i = 0; i < p.length; i += 3) {
      const x = p[i];
      const y = p[i + 1];
      const z = p[i + 2];
      if (out.sleeveOf(x, y, z)) continue;
      const band = Math.min(NB - 1, Math.max(0, Math.floor(((y - box.min.y) / h) * NB)));
      all2[band].xs.push(x);
      all2[band].zs.push(z);
    }
  });
  out.all = all2.map(finishBand);
  out.nearestAll = (band) => {
    for (let d = 1; d < NB; d++) {
      if (out.all[band - d]) return out.all[band - d];
      if (out.all[band + d]) return out.all[band + d];
    }
    return { cx: meshCx, cz: 0, hw: torsoHalf, hd: 0.05 };
  };
  return out;
}

/** Sleeve column statistics interpolated along the sleeve (s = 0 at the shoulder seam, 1 at the cuff). */
function sleeveCol(cols, s) {
  const NC = cols.length;
  const f = s * NC - 0.5;
  const c0 = Math.max(0, Math.min(NC - 1, Math.floor(f)));
  const c1 = Math.min(NC - 1, c0 + 1);
  const t = Math.max(0, Math.min(1, f - c0));
  const a = cols[c0];
  const b = cols[c1];
  if (a && b) return { yc: a.yc + (b.yc - a.yc) * t, yh: a.yh + (b.yh - a.yh) * t, zc: a.zc + (b.zc - a.zc) * t };
  if (a || b) return a ?? b;
  for (let d = 1; d < NC; d++) {
    if (cols[c0 - d]) return cols[c0 - d];
    if (cols[c0 + d]) return cols[c0 + d];
  }
  return null;
}

/** Remove faces whose three vertices all sit below yCut (opens a sealed hem). */
function openBottom(geo, orig, yCut) {
  let index = geo.getIndex();
  if (!index) {
    const n = geo.attributes.position.count;
    const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    index = new THREE.BufferAttribute(arr, 1);
  }
  const src = index.array;
  const keep = [];
  for (let i = 0; i < src.length; i += 3) {
    const a = src[i];
    const b = src[i + 1];
    const c = src[i + 2];
    if (orig[a * 3 + 1] < yCut && orig[b * 3 + 1] < yCut && orig[c * 3 + 1] < yCut) continue;
    keep.push(a, b, c);
  }
  geo.setIndex(keep.length > 65535 ? new THREE.Uint32BufferAttribute(keep, 1) : new THREE.Uint16BufferAttribute(keep, 1));
}

/** Width/depth of a mesh's bottom and top 12% (in its own units). */
function measureBands(scene, box) {
  const h = box.max.y - box.min.y;
  const lowCut = box.min.y + h * 0.12;
  const highCut = box.max.y - h * 0.12;
  const acc = { bottom: { xmin: Infinity, xmax: -Infinity, zmin: Infinity, zmax: -Infinity }, top: { xmin: Infinity, xmax: -Infinity, zmin: Infinity, zmax: -Infinity } };
  const v = new THREE.Vector3();
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 3) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      const band = v.y <= lowCut ? acc.bottom : v.y >= highCut ? acc.top : null;
      if (!band) continue;
      if (v.x < band.xmin) band.xmin = v.x;
      if (v.x > band.xmax) band.xmax = v.x;
      if (v.z < band.zmin) band.zmin = v.z;
      if (v.z > band.zmax) band.zmax = v.z;
    }
  });
  for (const k of ['bottom', 'top']) {
    const a = acc[k];
    a.width = Number.isFinite(a.xmin) ? a.xmax - a.xmin : 0;
    a.depth = Number.isFinite(a.zmin) ? a.zmax - a.zmin : 0;
  }
  return acc;
}

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

// Cloth-like: physical material with sheen reads as fabric rather than plastic.
const shellMaterial = new THREE.MeshPhysicalMaterial({
  vertexColors: true,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.94,
  roughness: 0.9,
  metalness: 0,
  sheen: 0.8,
  sheenRoughness: 0.7,
  sheenColor: new THREE.Color(0xffffff),
});

/**
 * Build a shell mesh from body rings between yBottom..yTop, offset & coloured by anchors.
 * opts.hangFromY: below this height the cloth hangs straight down from that ring (it never
 *                 pulls in tighter than the widest point above it).
 * opts.neckDip:   front neckline drop in metres at the top edge (crew neck).
 */
function ringsToMesh(ringsMap, yBottom, yTop, anchors, opts = {}) {
  const keys = [...ringsMap.keys()].sort((a, c) => a - c);
  const rings = keys.map((k) => ringsMap.get(k)).filter((r) => r.y >= yBottom - 0.011 && r.y <= yTop + 0.011);
  if (rings.length < 2) return null;
  // Snap the first and last ring to the exact cut heights.
  const list = rings.map((r) => ({ ...r }));
  list[0].y = Math.max(yBottom, 0.005);
  list[list.length - 1].y = yTop;

  // Hanging outline: radii of the widest ring + its ease, applied around each lower ring's own
  // centre (so it follows a leg that angles outward instead of poking through it).
  let hang = null;
  if (opts.hangFromY != null) {
    const hr = ringAt(ringsMap, opts.hangFromY);
    if (hr) {
      const hoff = Math.max(interpAnchors(anchors, hr.y).delta, MIN_GAP);
      hang = { y: hr.y, r: Array.from(hr.r, (v) => v + hoff) };
    }
  }

  const N = RING_BINS;
  const pos = new Float32Array(list.length * N * 3);
  const colors = new Float32Array(list.length * N * 3);
  let p = 0;
  for (const ring of list) {
    const { delta, color } = interpAnchors(anchors, ring.y);
    const off = Math.max(delta, MIN_GAP);
    const below = hang && ring.y < hang.y;
    for (let j = 0; j < N; j++) {
      const ang = (j / N) * TWO_PI - Math.PI;
      // Below the widest point the cloth never pulls in tighter than that point's outline.
      const r = below ? Math.max(ring.r[j] + off, hang.r[j]) : ring.r[j] + off;
      const x = ring.cx + r * Math.cos(ang);
      const z = ring.cz + r * Math.sin(ang);
      let y = ring.y;
      if (opts.neckDip) {
        // +z is the front of the avatar. Curve the top edge down at the front, a little at the back.
        const front = Math.max(0, Math.sin(ang));
        const back = Math.max(0, -Math.sin(ang));
        const cut = yTop - opts.neckDip * Math.pow(front, 1.5) - 0.015 * Math.pow(back, 2);
        if (y > cut) y = cut;
      }
      pos[p] = x;
      pos[p + 1] = y;
      pos[p + 2] = z;
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
