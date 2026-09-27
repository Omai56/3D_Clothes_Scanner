// 3D fit view for the FitCheck pages: the team's viewer (js/viewer.js, same as the main app)
// showing a saved 3D body scan wearing the garment, coloured by fit.
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

/**
 * Mount the 3D view in `stage`. `picker` gets a body selector (saved scans), `legend` the colour key.
 * Returns { show(size) } or throws if 3D can't run (no WebGL, no saved bodies).
 */
export async function mountFit3D({ stage, picker, legend, garment, preferScan = 'demo' }) {
  const scans = await (await fetch('/api/scans')).json();
  if (!scans.length) throw new Error('No saved 3D bodies');
  const vg = toViewerGarment(garment);
  const viewer = new FitViewer(stage);
  let report = null;
  let size = null;

  let current;
  try { current = sessionStorage.getItem('fit3dScan'); } catch { /* storage blocked */ }
  if (!scans.some((s) => s.name === current)) current = scans.some((s) => s.name === preferScan) ? preferScan : scans[0].name;

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
      if (request !== loading) return;
      report = fitReport(scan.measurements_cm, vg);
      try { sessionStorage.setItem('fit3dScan', name); } catch { /* storage blocked */ }
      if (size) render();
    } finally {
      if (request === loading) delete stage.dataset.loading;
    }
  }

  function render() {
    const ev = report?.sizes[size];
    if (ev) viewer.showFit(vg, ev);
  }

  await loadScan(current);
  return {
    show(s) {
      size = s;
      render();
    },
  };
}
