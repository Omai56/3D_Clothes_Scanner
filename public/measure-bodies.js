// Saved 3D bodies on the measure page: tap one (it turns black), the fields fill from that scan
// and the try-on page shows that body; then "Continue to try on". Reuses the page's own
// "use saved scan" handler (Fit.SAMPLE_SCAN + the #demo button) so the fill logic lives once.
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

  fetch('/api/scans')
    .then((r) => r.json())
    .then((scans) => {
      if (!scans.length) { box.hidden = true; demo.hidden = false; return; }
      for (const s of scans) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'saved-body';
        b.dataset.name = s.name;
        b.setAttribute('aria-pressed', String(s.name === current));
        const meta = [s.input?.heightCm ? `${s.input.heightCm} cm` : null, s.input?.photos ? 'phone scan' : 'sample'].filter(Boolean).join(' · ');
        b.innerHTML = `<b>${Fit.esc(s.label)}</b><span>${Fit.esc(meta)}</span>`;
        b.addEventListener('click', () => {
          row.querySelectorAll('.saved-body').forEach((x) => x.setAttribute('aria-pressed', 'false'));
          b.setAttribute('aria-pressed', 'true');
          note.textContent = 'Filling your measurements from this scan…';
          note.classList.remove('ok');
          Fit.SAMPLE_SCAN = s.name;
          demo.click(); // the page's own handler: fills the fields + remembers the body for the try-on page
          setTimeout(() => {
            note.textContent = `Using ${s.label}. Press “Continue to try on”.`;
            note.classList.add('ok');
            actions.querySelector('button[type="submit"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 700);
        });
        row.appendChild(b);
      }
    })
    .catch(() => { box.hidden = true; demo.hidden = false; });
})();
