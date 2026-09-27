// 3D fit view for the Fitting Room try-on page: the saved 3D body scan wearing the garments.
// Imported items (with a real size chart and a Tripo mesh) are shown as the actual garment mesh,
// scaled from the chart and set on the body; a top and a bottom can be worn together. Pieces
// without a mesh (standard-chart items) are shown as the measured shell coloured by fit.
import { FitViewer } from '/js/viewer.js';
import { fitReport, VERDICT_COLOR, VERDICT_LABEL } from '/shared/fit.js';

// FitCheck charts give garment circumferences; the viewer and fit engine use flat widths (half).
// They have no length or sleeve, so typical values for the item type fill in.
const TOP_DEFAULTS = {
  tee: { length: 70, sleeve: 20, sleeve_type: 'short' },
  shirt: { length: 76, sleeve: 64, sleeve_type: 'long' },
  hoodie: { length: 70, sleeve: 64, sleeve_type: 'long' },
  jacket: { length: 72, sleeve: 66, sleeve_type: 'long' },
};

export function toViewerGarment(g) {
  const top = g.category === 'top';
  const d = TOP_DEFAULTS[g.art] ?? TOP_DEFAULTS.tee;
  const sizes = {};
  for (const [s, v] of Object.entries(g.sizes)) {
    sizes[s] = top
      ? { chest: v.chest / 2, hem: v.waist / 2, shoulder: v.shoulder, length: d.length, sleeve: d.sleeve }
      : { waist: v.waist / 2, hip: v.hip / 2, inseam: v.inseam };
  }
  return {
    id: g.id,
    name: g.name,
    brand: g.brand,
    category: g.category,
    chart_type: 'garment_flat',
    sleeve_type: top ? d.sleeve_type : undefined,
    sizes,
  };
}

const slotOf = (g) => (g.category === 'top' ? 'top' : 'bottom');

/**
 * Mount the 3D view in `stage`. `picker` gets a body selector (saved scans), `legend` the colour key.
 * Returns { wear(garment, size), show(size), takeOff(category?), worn() }, or throws if 3D can't run.
 */
export async function mountFit3D({ stage, picker, legend, preferScan = null }) {
  const scans = await (await fetch('/api/scans')).json();
  if (!scans.length) throw new Error('No saved 3D bodies');
  const viewer = new FitViewer(stage);
  viewer.setMode('look');
  window.__viewer = viewer;
  let bodyCm = null;
  const worn = { top: null, bottom: null }; // { garment, vg, report, size }
  let active = null;

  let current;
  try { current = sessionStorage.getItem('fit3dScan'); } catch { /* storage blocked */ }
  if (!scans.some((s) => s.name === current)) {
    // the newest real phone scan, else the requested / demo body
    current = scans.find((s) => s.input?.photos)?.name ?? (scans.some((s) => s.name === preferScan) ? preferScan : scans[0].name);
  }

  picker.innerHTML = `<label>3D body <select>${scans.map((s) => `<option value="${s.name}">${s.label}</option>`).join('')}</select></label>`;
  const select = picker.querySelector('select');
  select.value = current;
  select.addEventListener('change', () => loadScan(select.value));

  legend.innerHTML = ['tight', 'snug', 'good', 'loose'].map((v) => `<span><i style="background:${VERDICT_COLOR[v]}"></i>${VERDICT_LABEL[v]}</span>`).join('');

  let loading = null;
  async function loadScan(name) {
    const request = (loading = name);
    stage.dataset.loading = 'Loading your 3D body…';
    try {
      const res = await fetch(`/api/scans/${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error('Saved body not found');
      const scan = await res.json();
      await viewer.loadBody(scan.objUrl, scan.measurements_cm);
      viewer.frameBody();
      if (request !== loading) return;
      bodyCm = scan.measurements_cm;
      try { sessionStorage.setItem('fit3dScan', name); } catch { /* storage blocked */ }
      // re-fit everything that is on
      for (const k of ['top', 'bottom']) if (worn[k]) { worn[k].report = fitReport(bodyCm, worn[k].vg); await render(k); }
    } finally {
      if (request === loading) delete stage.dataset.loading;
    }
  }

  async function render(k) {
    const w = worn[k];
    if (!w || !w.report) return;
    const ev = w.report.sizes[w.size] ?? w.report.sizes[w.report.recommended];
    let glb = w.garment.chart?.model?.glb ?? w.garment.model?.glb;
    if (!glb) {
      // a mesh saved earlier for this item (public/models/<id>.glb) is used even if the item's
      // record does not point at it (imported before the server learned to link it)
      const id = w.garment.chart?.id ?? w.garment.id;
      const probe = `/models/${encodeURIComponent(id)}.glb`;
      try {
        if ((await fetch(probe, { method: 'HEAD' })).ok) glb = probe;
      } catch { /* no mesh */ }
    }
    if (glb) {
      stage.dataset.loading = 'Putting it on you…';
      try {
        await viewer.loadGarmentModel(glb, w.vg, ev);
      } finally {
        delete stage.dataset.loading;
      }
    } else {
      viewer.clearGarmentModel(k);
      viewer.showFit(w.vg, ev);
    }
    viewer.setMode('look');
  }

  await loadScan(current);
  return {
    /** Put a garment on (it takes the slot of its category; the other category stays on). */
    async wear(garment, s) {
      const k = slotOf(garment);
      const vg = garment.chart ?? toViewerGarment(garment);
      const report = bodyCm ? fitReport(bodyCm, vg) : null;
      worn[k] = { garment, vg, report, size: s ?? report?.recommended };
      active = k;
      await render(k);
    },
    async show(s) {
      if (!active || !worn[active]) return;
      worn[active].size = s;
      await render(active);
    },
    takeOff(category) {
      const ks = category ? [category] : ['top', 'bottom'];
      for (const k of ks) {
        worn[k] = null;
        viewer.clearGarmentModel(k);
      }
      viewer.garmentGroup.clear();
      active = worn.top ? 'top' : worn.bottom ? 'bottom' : null;
      if (active) render(active);
    },
    setActive(category) {
      if (worn[category]) active = category;
    },
    worn: () => ({ ...worn }),
    viewer,
  };
}
