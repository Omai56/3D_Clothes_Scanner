// Saved 3D bodies on the measure page: tap one (it turns black), the fields fill from that scan
// and the try-on page shows that body; then "Continue to try on".
(function () {
  const demo = document.getElementById('demo');
  const actions = document.querySelector('.form-actions');
  if (!demo || !actions || !window.Fit) return;

  const style = document.createElement('style');
  style.textContent = `
    .saved-bodies { margin: 6px 6px 14px; }
    .saved-bodies h3 { margin: 0 0 8px; font-size: 11px; letter-spacing: .18em; text-transform: uppercase; font-weight: 600; color: var(--muted, #857d74); }
    .saved-bodies .row { display: flex; flex-wrap: wrap; gap: 8px; }
    .saved-body { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 14px; border: 1px solid var(--line-strong, #dcd4c8); border-radius: var(--radius, 0); background: var(--surface, #fff); color: var(--ink, #1a1816); font: inherit; cursor: pointer; text-align: left; }
    .saved-body b { font-size: 14px; font-weight: 600; }
    .saved-body span { font-size: 12px; color: var(--muted, #857d74); }
    .saved-body[aria-pressed="true"] { background: var(--ink, #000); border-color: var(--ink, #000); color: var(--bg, #fff); }
    .saved-body[aria-pressed="true"] span { color: inherit; opacity: .8; }
    .saved-body[aria-pressed="true"] b::before { content: "✓ "; }
    .saved-bodies .note { margin: 8px 0 0; font-size: 12.5px; color: var(--muted, #857d74); }
    .saved-bodies .note.ok { color: var(--ink, #1a1816); }
    /* the step indicator never lets the label sit on the dot */
    .steps li { gap: 8px; }
    .steps .dot { flex: none; }
    .steps .lbl { white-space: nowrap; }
  `;
  document.head.appendChild(style);

  const box = document.createElement('div');
  box.className = 'saved-bodies';
  box.innerHTML = '<h3>Saved 3D bodies</h3><div class="row"></div><p class="note">Tap a body to use it, then continue.</p>';
  actions.parentNode.insertBefore(box, actions);
  const row = box.querySelector('.row');
  const note = box.querySelector('.note');
  demo.hidden = true; // replaced by the list

  let current = null;
  try { current = sessionStorage.getItem('fit3dScan'); } catch (e) { /* ignore */ }
  const niceLabel = (s) => (/^scan-/.test(s.name) && s.createdAt ? `Your scan · ${new Date(s.createdAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : s.label);

  let known = '';
  function renderList(scans) {
      if (!scans.length) { box.hidden = true; demo.hidden = false; return; }
      box.hidden = false;
      row.innerHTML = '';
      for (const s of scans) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'saved-body';
        b.dataset.name = s.name;
        b.setAttribute('aria-pressed', String(s.name === current));
        const meta = [s.input?.heightCm ? `${s.input.heightCm} cm` : null, s.input?.photos ? 'phone scan' : 'sample'].filter(Boolean).join(' · ');
        b.innerHTML = `<b>${Fit.esc(niceLabel(s))}</b><span>${Fit.esc(meta)}</span>`;
        b.addEventListener('click', () => {
          row.querySelectorAll('.saved-body').forEach((x) => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
          note.textContent = 'Filling your measurements from this scan…';
          note.classList.remove('ok');
          fetch(`/api/scans/${encodeURIComponent(s.name)}`)
            .then((r) => r.json())
            .then((scan) => {
              const m = scan.measurements_cm || {};
              const cm = { height: scan.input?.heightCm, chest: m.bustGirth, waist: m.waistGirth, hip: m.hipGirth, inseam: m.insideLegHeight, shoulder: m.acrossBackShoulderWidth };
              const inches = document.querySelector('.unit-toggle [data-unit="in"]')?.getAttribute('aria-pressed') === 'true';
              for (const [key, v] of Object.entries(cm)) {
                const input = document.querySelector(`#fields input[name="${key}"]`);
                if (!input || v == null) continue;
                input.value = (inches ? v / 2.54 : v).toFixed(1).replace(/\.0$/, '');
                input.dispatchEvent(new Event('input', { bubbles: true })); // the page validates + updates progress
              }
              try { sessionStorage.setItem('fit3dScan', s.name); } catch (e) { /* ignore */ } // the try-on page shows this body
              note.textContent = `Using ${niceLabel(s)}. Press “Continue to try on”.`;
              note.classList.add('ok');
              actions.querySelector('button[type="submit"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            })
            .catch(() => { note.textContent = 'Could not read that scan. Try again.'; });
        });
        row.appendChild(b);
      }
  }
  async function refresh() {
    try {
      const scans = await (await fetch('/api/scans')).json();
      const sig = scans.map((s) => s.name).join(',');
      if (sig === known) return;
      const prev = known.split(',').filter(Boolean);
      const isNew = known !== '' && scans.some((s) => !prev.includes(s.name));
      known = sig;
      // a scan that just finished is selected and used straight away
      if (isNew) {
        const fresh = scans.find((s) => !prev.includes(s.name)) ?? scans[0];
        current = fresh.name;
        try { sessionStorage.setItem('fit3dScan', fresh.name); } catch (e) { /* ignore */ }
      }
      renderList(scans);
      if (isNew) {
        note.textContent = `Your new scan is in. Press “Continue to try on”.`;
        note.classList.add('ok');
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (e) { if (!known) { box.hidden = true; demo.hidden = false; } }
  }
  refresh();
  setInterval(refresh, 5000); // picks up a scan finished on the phone without reloading
})();
