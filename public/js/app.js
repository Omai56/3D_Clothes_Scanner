import { VERDICT_COLOR, VERDICT_LABEL } from '/shared/fit.js';

const $ = (s) => document.querySelector(s);
const state = {
  scan: null, // { name, measurements_cm, landmarks_cm, objUrl }
  garment: null,
  report: null,
  size: null,
  meshyUrl: null, // cached GLB URL for the current garment
};
let viewer = null;
let pollTimer = null;
let meshyTimer = null;

// ---------- navigation ----------
const screens = { body: $('#screen-body'), item: $('#screen-item'), fit: $('#screen-fit') };
const order = ['body', 'item', 'fit'];
function show(step) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== step;
  document.querySelectorAll('#steps li').forEach((li) => {
    const i = order.indexOf(li.dataset.step);
    li.classList.toggle('active', li.dataset.step === step);
    li.classList.toggle('done', i < order.indexOf(step));
  });
  $('#back').hidden = step === 'body';
  window.scrollTo({ top: 0 });
  state.step = step;
}
$('#back').addEventListener('click', () => show(order[Math.max(0, order.indexOf(state.step) - 1)]));

// ---------- step 1: body ----------
async function loadSavedScans() {
  const list = await (await fetch('/api/scans')).json();
  const el = $('#saved-scans');
  el.innerHTML = '';
  if (!list.length) el.innerHTML = '<p class="muted small">No saved bodies yet.</p>';
  for (const s of list) {
    const btn = document.createElement('button');
    btn.className = 'card';
    const when = s.createdAt ? new Date(s.createdAt * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '';
    const inp = s.input ? `${s.input.heightCm ?? ''} cm · ${s.input.weightKg ?? ''} kg · ${s.input.gender ?? ''}` : '';
    btn.innerHTML = `<span><span class="card-title">${esc(s.label)}</span><span class="card-sub">${esc(inp)}</span></span><span class="meta">${esc(when)}</span>`;
    btn.addEventListener('click', () => selectScan(s.name, btn));
    el.appendChild(btn);
  }
  return list;
}

async function selectScan(name, btn) {
  document.querySelectorAll('#saved-scans .card').forEach((c) => c.classList.remove('selected'));
  btn?.classList.add('selected');
  const res = await fetch(`/api/scans/${name}`);
  if (!res.ok) {
    await loadSavedScans();
    return alert('That saved body is no longer available. Please pick another.');
  }
  const scan = await res.json();
  state.scan = scan;
  sessionStorage.setItem('scan', name);
  const m = scan.measurements_cm;
  const rows = [
    ['Chest', m.bustGirth], ['Waist', m.waistGirth], ['Hips', m.hipGirth],
    ['Shoulders', m.acrossBackShoulderWidth], ['Inseam', m.insideLegHeight], ['Arm', m.outerArmLengthR],
  ];
  $('#body-measurements').innerHTML = rows
    .filter(([, v]) => v != null)
    .map(([k, v]) => `<div class="measure"><b>${v.toFixed(0)}<small> cm</small></b><span>${k}</span></div>`)
    .join('');
  $('#body-summary').hidden = false;
  $('#body-summary').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
$('#btn-body-next').addEventListener('click', () => show('item'));

$('#btn-scan').addEventListener('click', async () => {
  const btn = $('#btn-scan');
  btn.disabled = true;
  try {
    const r = await fetch('/api/scan-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Could not start scan');
    // open scanner (new tab so the camera permission is clean)
    window.open(data.url, '_blank');
    $('#scan-wait').hidden = false;
    clearInterval(pollTimer);
    const started = Date.now();
    pollTimer = setInterval(async () => {
      const p = await (await fetch(`/api/scan-session/${data.sessionId}`)).json();
      if (p.ready) {
        clearInterval(pollTimer);
        $('#scan-wait').hidden = true;
        await loadSavedScans();
        const card = [...document.querySelectorAll('#saved-scans .card')][0];
        await selectScan(p.name, card);
      } else if (p.failed) {
        clearInterval(pollTimer);
        $('#scan-wait-text').textContent = 'The scan failed (' + (p.error?.code ?? 'unknown') + '). Try again with better lighting.';
      } else if (Date.now() - started > 8 * 60 * 1000) {
        clearInterval(pollTimer);
        $('#scan-wait').hidden = true;
      }
    }, 4000);
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
});

// ---------- step 2: item ----------
async function loadGarments() {
  const list = await (await fetch('/api/garments')).json();
  const el = $('#garments');
  el.innerHTML = '';
  for (const g of list) {
    const btn = document.createElement('button');
    btn.className = 'card';
    btn.innerHTML = `<img src="${esc(g.images?.[0] ?? '')}" alt="" /><span class="card-title">${esc(g.name)}</span><span class="card-sub">${esc(g.brand)} · ${Object.keys(g.sizes).join(' ')}</span>`;
    btn.addEventListener('click', () => selectGarment(g));
    el.appendChild(btn);
  }
}

$('#import-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('#import-url').value.trim();
  const st = $('#import-status');
  st.hidden = false;
  st.className = 'status';
  st.textContent = 'Pulling the product page, size chart and photos… (10–20 s)';
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const r = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    if (data.imported) {
      st.textContent = `Imported “${data.garment.name}” with ${Object.keys(data.garment.sizes).length} sizes.`;
      await loadGarments();
      await selectGarment(data.garment);
      return;
    }
    st.textContent = `Found “${data.name}”. This store doesn't expose its size chart, so pick the matching saved item below.`;
  } catch (err) {
    st.className = 'status err';
    st.textContent = `${err.message} Pick a saved item below instead.`;
  } finally {
    btn.disabled = false;
  }
});

async function selectGarment(g) {
  if (!state.scan?.name) return show('body');
  state.garment = g;
  state.meshyUrl = null;
  clearInterval(meshyTimer);
  if (viewer) viewer.clearGarmentModel();
  const r = await fetch('/api/fit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scan: state.scan.name, garment_id: g.id }),
  });
  const data = await r.json();
  if (r.status === 404 && data.error?.includes('body')) {
    // The saved body disappeared (renamed/removed on the server): refresh the list and go back.
    state.scan = null;
    sessionStorage.removeItem('scan');
    $('#body-summary').hidden = true;
    await loadSavedScans();
    show('body');
    return alert('That saved body is no longer available. Please pick a body again.');
  }
  if (!r.ok) return alert(data.error);
  state.report = data.report;
  state.size = data.report.recommended;
  show('fit');
  await renderFit();
  // A ready-made mesh (Tripo/Meshy GLB saved under public/models and referenced by the garment)
  // wins over generating a new one.
  if (g.model?.glb) await applyMeshyModel(g.model.glb, g);
  else if (g.images?.[0]) kickOffMeshy(g);
}

// ---------- step 3: fit ----------
async function renderFit() {
  const g = state.garment;
  const rep = state.report;
  $('#fit-img').src = g.images?.[0] ?? '';
  $('#fit-brand').textContent = g.brand;
  $('#fit-name').textContent = g.name;
  $('#fit-fabric').textContent = [g.fabric, g.stretch ? `${g.stretch} stretch` : null].filter(Boolean).join(' · ');

  const sizesEl = $('#sizes');
  sizesEl.innerHTML = '';
  for (const s of rep.size_order) {
    const ev = rep.sizes[s];
    const btn = document.createElement('button');
    btn.className = 'size' + (s === state.size ? ' active' : '');
    const dots = Object.values(ev.regions).map((r) => `<i style="background:${VERDICT_COLOR[r.verdict]}"></i>`).join('');
    btn.innerHTML = `${esc(s)}${s === rep.recommended ? '<span class="rec">BEST</span>' : ''}<span class="dots">${dots}</span>`;
    btn.addEventListener('click', () => {
      state.size = s;
      renderFit();
    });
    sizesEl.appendChild(btn);
  }

  const ev = rep.sizes[state.size];
  const worst = worstVerdict(ev);
  $('#fit-verdict').innerHTML = `Size ${esc(state.size)} <span class="pill" style="background:${VERDICT_COLOR[worst]}">${overallLabel(ev, rep)}</span>`;
  $('#fit-summary').textContent = ev.summary;
  $('#fit-regions').innerHTML = Object.values(ev.regions)
    .map((r) => {
      const detail = r.ease_cm != null
        ? `${r.garment_cm} cm garment vs ${r.body_cm ?? '–'} cm you · ${r.ease_cm > 0 ? '+' : ''}${r.ease_cm} cm`
        : r.lands_at ? `ends ${r.lands_at}` : '';
      return `<li><i style="background:${VERDICT_COLOR[r.verdict]}"></i><span class="r-label">${esc(r.label)}<span class="r-detail">${esc(detail)}</span></span><span class="r-verdict" style="color:${VERDICT_COLOR[r.verdict]}">${VERDICT_LABEL[r.verdict]}</span></li>`;
    })
    .join('');
  $('#fit-notes').innerHTML = rep.notes.map((n) => `<li>${esc(n)}</li>`).join('');

  // 3D
  if (!viewer) {
    const { FitViewer } = await import('/js/viewer.js');
    viewer = new FitViewer($('#viewer'));
  }
  let loading = $('#viewer .viewer-loading');
  if (viewer._objUrl !== state.scan.objUrl) {
    loading = document.createElement('div');
    loading.className = 'viewer-loading';
    loading.textContent = 'Loading your 3D body…';
    $('#viewer').appendChild(loading);
  }
  try {
    await viewer.loadBody(state.scan.objUrl, state.scan.measurements_cm);
    viewer.showFit(g, ev);
    if (state.meshyUrl) await viewer.loadGarmentModel(state.meshyUrl, g, ev);
  } finally {
    loading?.remove();
  }
}

function worstVerdict(ev) {
  const rank = { tight: 0, very_loose: 1, loose: 2, snug: 3, good: 4 };
  let w = 'good';
  for (const r of Object.values(ev.regions)) if (rank[r.verdict] < rank[w]) w = r.verdict;
  return w;
}
function overallLabel(ev, rep) {
  const w = worstVerdict(ev);
  if (ev.size === rep.recommended) return 'Best fit';
  return { tight: 'Too tight', very_loose: 'Too big', loose: 'Relaxed', snug: 'Snug', good: 'Fits' }[w];
}

// ---------- meshy image-to-3D ----------
async function kickOffMeshy(garment) {
  clearInterval(meshyTimer);
  const imageUrl = garment.images?.[0];
  if (!imageUrl) return;

  setMeshyStatus('Generating 3D model…');
  try {
    const r = await fetch('/api/meshy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ garment_id: garment.id, image_url: imageUrl }),
    });
    const data = await r.json();
    if (!r.ok) { setMeshyStatus(''); return; }
    if (data.cached) { await applyMeshyModel(data.modelUrl, garment); return; }

    const taskId = data.taskId;
    meshyTimer = setInterval(async () => {
      try {
        const pr = await fetch(`/api/meshy/${taskId}?garment_id=${encodeURIComponent(garment.id)}`);
        const pd = await pr.json();
        if (pd.status === 'SUCCEEDED') {
          clearInterval(meshyTimer);
          await applyMeshyModel(pd.modelUrl, garment);
        } else if (pd.status === 'FAILED') {
          clearInterval(meshyTimer);
          setMeshyStatus('');
        } else {
          setMeshyStatus(`Generating 3D model… ${pd.progress ?? 0}%`);
        }
      } catch { /* network hiccup, keep polling */ }
    }, 5000);
  } catch {
    setMeshyStatus('');
  }
}

async function applyMeshyModel(url, garment) {
  setMeshyStatus('');
  state.meshyUrl = url;
  if (!viewer || !state.report) return;
  const ev = state.report.sizes[state.size];
  await viewer.loadGarmentModel(url, garment, ev);
}

function setMeshyStatus(msg) {
  const el = $('#meshy-status');
  if (!el) return;
  el.textContent = msg;
  el.hidden = !msg;
}

$('#btn-another').addEventListener('click', () => show('item'));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- boot ----------
(async () => {
  show('body');
  const scans = await loadSavedScans();
  loadGarments();
  // Prefer: the body used earlier this session → the newest real phone scan → the demo body.
  const remembered = sessionStorage.getItem('scan');
  const pick =
    scans.find((s) => s.name === remembered) ?? scans.find((s) => s.input?.photos) ?? scans.find((s) => s.name === 'demo') ?? scans[0];
  if (pick) {
    const card = [...document.querySelectorAll('#saved-scans .card')][scans.indexOf(pick)];
    await selectScan(pick.name, card);
  }
})();
