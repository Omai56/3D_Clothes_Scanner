const $ = (s) => document.querySelector(s);
const state = {
  scan: null, // { name, measurements_cm, landmarks_cm, objUrl }
  garment: null,
  garments: [],
  report: null,
  size: null,
  meshyUrl: null,
  waistOffset: 0,
  step: 'body',
};
let viewer = null;
let pollTimer = null;
let meshyTimer = null;

// ---------- navigation ----------
const screens = { body: $('#screen-body'), room: $('#screen-room') };
function show(step) {
  for (const [k, el] of Object.entries(screens)) el.hidden = k !== step;
  $('#back').hidden = step === 'body';
  window.scrollTo({ top: 0 });
  state.step = step;
  if (step === 'room' && viewer) viewer.resize();
}
$('#back').addEventListener('click', () => show('body'));

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
    btn.addEventListener('click', () => selectScan(s.name, btn, true));
    el.appendChild(btn);
  }
  return list;
}

// Pick a body. With `enter` the room opens straight away with the 3D body in it.
async function selectScan(name, btn, enter = false) {
  document.querySelectorAll('#saved-scans .card').forEach((c) => c.classList.remove('selected'));
  btn?.classList.add('selected');
  const res = await fetch(`/api/scans/${name}`);
  if (!res.ok) {
    await loadSavedScans();
    return alert('That saved body is no longer available. Please pick another.');
  }
  const scan = await res.json();
  const changed = state.scan?.name !== scan.name;
  state.scan = scan;
  sessionStorage.setItem('scan', name);
  if (enter) {
    show('room');
    await ensureBody();
    if (changed && state.garment) await selectGarment(state.garment); // re-fit on the new body
  }
}

async function ensureViewer() {
  if (viewer) return viewer;
  const { FitViewer } = await import('/js/viewer.js');
  viewer = new FitViewer($('#viewer'));
  viewer.setMode('look');
  window.__viewer = viewer; // for debugging / screenshots
  return viewer;
}

async function ensureBody() {
  await ensureViewer();
  if (viewer._objUrl === state.scan.objUrl) return;
  const loading = document.createElement('div');
  loading.className = 'viewer-loading';
  loading.textContent = 'Loading your 3D body…';
  $('#viewer').appendChild(loading);
  try {
    await viewer.loadBody(state.scan.objUrl, state.scan.measurements_cm);
    viewer.frameBody();
  } finally {
    loading.remove();
  }
}

// ---------- scanner (in the app; falls back to a new tab) ----------
$('#btn-scan').addEventListener('click', async () => {
  const btn = $('#btn-scan');
  btn.disabled = true;
  try {
    const r = await fetch('/api/scan-session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Could not start scan');
    openScanner(data.url);
    $('#scan-wait').hidden = false;
    clearInterval(pollTimer);
    const started = Date.now();
    pollTimer = setInterval(async () => {
      const p = await (await fetch(`/api/scan-session/${data.sessionId}`)).json();
      if (p.ready) {
        clearInterval(pollTimer);
        closeScanner();
        $('#scan-wait').hidden = true;
        await loadSavedScans();
        const card = [...document.querySelectorAll('#saved-scans .card')][0];
        await selectScan(p.name, card, true);
      } else if (p.failed) {
        clearInterval(pollTimer);
        closeScanner();
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
function openScanner(url) {
  $('#scan-newtab').href = url;
  $('#scan-frame').src = url;
  $('#scan-overlay').hidden = false;
}
function closeScanner() {
  $('#scan-overlay').hidden = true;
  $('#scan-frame').src = 'about:blank';
}
$('#scan-close').addEventListener('click', closeScanner);
$('#scan-newtab').addEventListener('click', () => setTimeout(closeScanner, 300));

// ---------- closet ----------
async function loadGarments() {
  state.garments = await (await fetch('/api/garments')).json();
  renderCloset();
}
function renderCloset() {
  const el = $('#garments');
  el.innerHTML = '';
  for (const g of state.garments) {
    const btn = document.createElement('button');
    btn.className = 'card' + (state.garment?.id === g.id ? ' worn' : '');
    btn.dataset.id = g.id;
    btn.innerHTML = `<img src="${esc(g.images?.[0] ?? '')}" alt="" /><span class="card-title">${esc(g.name)}</span><span class="card-sub">${esc(g.brand)}</span>`;
    attachDrag(btn, { garment: g, kind: 'closet' });
    el.appendChild(btn);
  }
}
function openCloset(on = true) {
  $('#closet').hidden = !on;
  if (on) setPanel(false);
}
$('#closet-btn').addEventListener('click', () => openCloset($('#closet').hidden));
$('#closet-close').addEventListener('click', () => openCloset(false));

// ---------- side panel ----------
function setPanel(open) {
  $('#panel').classList.toggle('closed', !open);
  if (viewer) {
    const w = $('#stage').clientWidth;
    const panelW = Math.min(280, w * 0.58);
    viewer.viewShift = open ? panelW * 0.42 : 0;
  }
}
$('#panel-tab').addEventListener('click', () => setPanel($('#panel').classList.contains('closed')));

// ---------- import a link ----------
$('#import-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = $('#import-url').value.trim();
  if (!url) return openCloset(true);
  const st = $('#import-status');
  st.hidden = false;
  st.className = 'status toast';
  st.textContent = 'Pulling the product page, size chart and photos… (10–20 s)';
  const btn = $('#import-btn');
  btn.disabled = true;
  try {
    const r = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    if (data.imported) {
      st.hidden = true;
      $('#import-url').value = '';
      await loadGarments();
      await selectGarment(data.garment);
      return;
    }
    st.textContent = `Found “${data.name}”. This store doesn't expose its size chart, so pick a saved item from the closet.`;
  } catch (err) {
    st.className = 'status toast err';
    st.textContent = `${err.message} Pick a saved item from the closet instead.`;
  } finally {
    btn.disabled = false;
  }
});

// ---------- wearing an item ----------
async function fetchFit(g) {
  return fetch('/api/fit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scan: state.scan.name, garment_id: g.id, waist_offset_cm: state.waistOffset ?? 0 }),
  });
}

async function selectGarment(g) {
  if (!state.scan?.name) return show('body');
  state.garment = g;
  state.meshyUrl = null;
  state.waistOffset = 0;
  clearInterval(meshyTimer);
  openCloset(false);
  await ensureBody();
  viewer.clearGarmentModel();
  const r = await fetchFit(g);
  const data = await r.json();
  if (r.status === 404 && data.error?.includes('body')) {
    state.scan = null;
    sessionStorage.removeItem('scan');
    await loadSavedScans();
    show('body');
    return alert('That saved body is no longer available. Please pick a body again.');
  }
  if (!r.ok) return alert(data.error);
  state.report = data.report;
  state.size = data.report.recommended;
  renderCloset();
  await renderItem();
  setPanel(true);
  if (g.model?.glb) await applyModel(g.model.glb, g);
  else if (g.images?.[0]) kickOffMeshy(g);
}

function takeOff() {
  clearInterval(meshyTimer);
  state.garment = null;
  state.report = null;
  state.meshyUrl = null;
  if (viewer) viewer.clearGarmentModel();
  $('#panel-item').hidden = true;
  $('#panel-empty').hidden = false;
  renderCloset();
  setPanel(false);
}
$('#btn-takeoff').addEventListener('click', takeOff);

async function renderItem() {
  const g = state.garment;
  const rep = state.report;
  $('#panel-empty').hidden = true;
  $('#panel-item').hidden = false;
  $('#fit-img').src = g.images?.[0] ?? '';
  $('#wearing-img').src = g.images?.[0] ?? '';
  $('#fit-brand').textContent = g.brand;
  $('#fit-name').textContent = g.name;
  $('#fit-fabric').textContent = [g.fabric, g.stretch ? `${g.stretch} stretch` : null].filter(Boolean).join(' · ');

  const sizesEl = $('#sizes');
  sizesEl.innerHTML = '';
  for (const s of rep.size_order) {
    const btn = document.createElement('button');
    btn.className = 'size' + (s === state.size ? ' active' : '');
    btn.innerHTML = `${esc(s)}${s === rep.recommended ? '<span class="rec">BEST</span>' : ''}`;
    btn.addEventListener('click', async () => {
      state.size = s;
      await renderItem();
      if (state.meshyUrl) await drape(state.meshyUrl, g, rep.sizes[s]);
    });
    sizesEl.appendChild(btn);
  }
  const ev = rep.sizes[state.size];
  $('#fit-summary').textContent = ev.summary;

  const wc = $('#waist-control');
  wc.hidden = g.category !== 'bottom';
  if (g.category === 'bottom') {
    $('#waist-slider').value = String(state.waistOffset ?? 0);
    const off = state.waistOffset ?? 0;
    const style = rep.rise_style ? `${rep.rise_style}-rise` : '';
    $('#waist-label').textContent = off === 0 ? `${style} default` : off < 0 ? `${Math.abs(off)} cm lower` : `${off} cm higher`;
  }
  $('#add-model').hidden = !!(g.model?.glb || state.meshyUrl);
}

// Attach a .glb (made on tripo3d.ai from the product photo) to the current item, then show it.
$('#model-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  const st = $('#add-model-status');
  if (!file || !state.garment) return;
  st.textContent = `Uploading ${file.name} (${(file.size / 1e6).toFixed(1)} MB)…`;
  try {
    const r = await fetch(`/api/garments/${encodeURIComponent(state.garment.id)}/model`, { method: 'POST', headers: { 'Content-Type': 'model/gltf-binary' }, body: file });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'upload failed');
    state.garment = data.garment;
    st.textContent = 'Added. Draping…';
    await applyModel(data.garment.model.glb, data.garment);
    $('#add-model').hidden = true;
    loadGarments();
  } catch (err) {
    st.textContent = err.message;
  } finally {
    e.target.value = '';
  }
});

async function drape(url, garment, ev) {
  setStatus('Putting it on you…');
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  try {
    await viewer.loadGarmentModel(url, garment, ev);
    viewer.setMode('look');
  } finally {
    setStatus('');
  }
}

async function applyModel(url, garment) {
  setStatus('');
  state.meshyUrl = url;
  if (!viewer || !state.report) return;
  await drape(url, garment, state.report.sizes[state.size]);
}

// ---------- meshy image-to-3D (Samuel's pipeline; no-op without a key) ----------
async function kickOffMeshy(garment) {
  clearInterval(meshyTimer);
  const imageUrl = garment.images?.[0];
  if (!imageUrl) return;
  try {
    const r = await fetch('/api/meshy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ garment_id: garment.id, image_url: imageUrl }) });
    const data = await r.json();
    if (!r.ok) return;
    if (data.cached) return applyModel(data.modelUrl, garment);
    setStatus('Generating 3D model…');
    meshyTimer = setInterval(async () => {
      try {
        const pr = await fetch(`/api/meshy/${data.taskId}?garment_id=${encodeURIComponent(garment.id)}`);
        const pd = await pr.json();
        if (pd.status === 'SUCCEEDED') { clearInterval(meshyTimer); await applyModel(pd.modelUrl, garment); }
        else if (pd.status === 'FAILED') { clearInterval(meshyTimer); setStatus(''); }
        else setStatus(`Generating 3D model… ${pd.progress ?? 0}%`);
      } catch { /* keep polling */ }
    }, 5000);
  } catch { setStatus(''); }
}

function setStatus(msg) {
  const el = $('#meshy-status');
  el.textContent = msg;
  el.hidden = !msg;
}

// Waistband slider: re-run the fit at the new height and re-drape (the crotch and hem move too).
let waistTimer = null;
$('#waist-slider').addEventListener('input', (e) => {
  state.waistOffset = Number(e.target.value);
  const off = state.waistOffset;
  $('#waist-label').textContent = off === 0 ? `${state.report?.rise_style ?? ''}-rise default` : off < 0 ? `${Math.abs(off)} cm lower` : `${off} cm higher`;
  clearTimeout(waistTimer);
  waistTimer = setTimeout(async () => {
    if (!state.garment) return;
    const r = await fetchFit(state.garment);
    const data = await r.json();
    if (!r.ok) return;
    state.report = data.report;
    if (!state.report.sizes[state.size]) state.size = state.report.recommended;
    await renderItem();
    if (state.meshyUrl) await drape(state.meshyUrl, state.garment, state.report.sizes[state.size]);
  }, 200);
});

// ---------- press-and-hold drag: closet -> body puts it on, body -> closet takes it off ----------
const HOLD_MS = 450;
function attachDrag(el, payload) {
  let timer = null;
  let start = null;
  let lifted = false;
  const ghost = $('#drag-ghost');
  const ghostImg = ghost.querySelector('img');
  const cancelHold = () => { clearTimeout(timer); timer = null; };
  const moveGhost = (x, y) => { ghost.style.left = `${x}px`; ghost.style.top = `${y}px`; };
  const targetAt = (x, y) => {
    const wasHidden = ghost.hidden;
    ghost.hidden = true;
    const hit = document.elementFromPoint(x, y);
    ghost.hidden = wasHidden;
    if (!hit) return null;
    if (hit.closest('#viewer') || hit.closest('#drop-hint') || hit.closest('.hint')) return 'body';
    if (hit.closest('#closet-btn') || hit.closest('#closet')) return 'closet';
    return null;
  };
  const highlight = (t) => {
    $('#stage').classList.toggle('dropping', t === 'body' && payload.kind === 'closet');
    $('#closet-btn').classList.toggle('drop-target', t === 'closet' && payload.kind === 'worn');
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button && e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    cancelHold();
    timer = setTimeout(() => {
      lifted = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('lifting');
      ghostImg.src = payload.garment.images?.[0] ?? '';
      ghost.hidden = false;
      moveGhost(e.clientX, e.clientY);
      if (payload.kind === 'closet') {
        $('#closet').classList.add('lifted');
        $('#drop-hint').hidden = false;
      }
      if (navigator.vibrate) navigator.vibrate(15);
    }, HOLD_MS);
  });
  el.addEventListener('pointermove', (e) => {
    if (!start) return;
    if (!lifted) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) cancelHold(); // a scroll, not a hold
      return;
    }
    e.preventDefault();
    moveGhost(e.clientX, e.clientY);
    highlight(targetAt(e.clientX, e.clientY));
  });
  const finish = async (e) => {
    cancelHold();
    if (!start) return;
    const wasLifted = lifted;
    const x = e.clientX;
    const y = e.clientY;
    start = null;
    lifted = false;
    el.classList.remove('lifting');
    ghost.hidden = true;
    $('#closet').classList.remove('lifted');
    $('#drop-hint').hidden = true;
    highlight(null);
    if (!wasLifted) {
      if (e.type === 'pointerup' && payload.kind === 'closet') await selectGarment(payload.garment); // a tap
      return;
    }
    const t = targetAt(x, y);
    if (payload.kind === 'closet' && t === 'body') await selectGarment(payload.garment);
    if (payload.kind === 'worn' && t === 'closet') takeOff();
  };
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}
// the worn chip in the panel can be dragged back to the closet
attachDrag($('#wearing-chip'), { get garment() { return state.garment ?? {}; }, kind: 'worn' });

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- boot ----------
(async () => {
  show('body');
  const scans = await loadSavedScans();
  loadGarments();
  // Pre-select the body used earlier this session → the newest real phone scan → the demo body
  // (selection only; the room opens when the person taps a body).
  const remembered = sessionStorage.getItem('scan');
  const pick =
    scans.find((s) => s.name === remembered) ?? scans.find((s) => s.input?.photos) ?? scans.find((s) => s.name === 'demo') ?? scans[0];
  if (pick) {
    const card = [...document.querySelectorAll('#saved-scans .card')][scans.indexOf(pick)];
    await selectScan(pick.name, card, false);
  }
})();
