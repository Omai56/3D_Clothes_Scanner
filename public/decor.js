// Warm decorations for the Fitting Room pages (the wardrobe has its own, in shop.html).
// Purely decorative: everything is aria-hidden and ignores the pointer, so it never gets in the way.
(function () {
  const page = document.querySelector('main.page');
  if (!page) return;

  const PLANT = '<svg viewBox="0 0 54 64"><path d="M27 40C20 30 10 28 6 16c10 2 18 10 21 22z" fill="#8fae7c"/><path d="M27 40c3-14 13-18 21-28 0 14-10 22-20 28z" fill="#7a9a68"/><path d="M27 40c-3-14-1-28 3-38 6 12 2 28-2 38z" fill="#a3bf8f"/><path d="M27 40c-9-4-19-2-25-8 8-4 18 0 25 7z" fill="#6f8f5e"/><path d="M13 40h28l-4 22H17z" fill="#c8693f"/><rect x="11" y="37" width="32" height="7" rx="2" fill="#d97d52"/><path d="M27 57c-3-2-5-3.5-5-5.5a2.2 2.2 0 0 1 5-1 2.2 2.2 0 0 1 5 1c0 2-2 3.5-5 5.5z" fill="#f6d9b8"/></svg>';

  function add(parent, cls, html) {
    const el = document.createElement('div');
    el.className = cls;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = html;
    parent.appendChild(el);
    return el;
  }

  // Fairy lights draped across the top of the page: three swags, five bulbs each.
  const swags = 3;
  let bulbs = '';
  for (let k = 0; k < swags; k++) {
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      bulbs += `<i style="left:${(((k + t) / swags) * 100).toFixed(1)}%;top:${Math.round(1 + 56 * t * (1 - t))}px"></i>`;
    }
  }
  let wire = 'M0 1';
  for (let k = 0; k < swags; k++) wire += `Q${(((k + 0.5) / swags) * 100).toFixed(2)} 29 ${(((k + 1) / swags) * 100).toFixed(2)} 1`;
  add(page, 'page-lights', `<svg viewBox="0 0 100 16" preserveAspectRatio="none"><path d="${wire}" fill="none" stroke="#8c6a2e" stroke-width="1.2" vector-effect="non-scaling-stroke"/></svg>${bulbs}`);

  // Little hand-drawn doodles in the side margins (wide screens only, see CSS).
  const heart = c => `<svg viewBox="0 0 24 22"><path d="M12 20C6 16 2 12.5 2 8a5 5 0 0 1 10-1.5A5 5 0 0 1 22 8c0 4.5-4 8-10 12z" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/></svg>`;
  const sparkle = c => `<svg viewBox="0 0 24 24"><path d="M12 1c1 6 5 10 11 11-6 1-10 5-11 11-1-6-5-10-11-11 6-1 10-5 11-11z" fill="${c}"/></svg>`;
  const flower = (c, mid) => `<svg viewBox="0 0 24 24">${[0, 72, 144, 216, 288].map(a => `<ellipse cx="12" cy="6" rx="3.6" ry="5" fill="${c}" transform="rotate(${a} 12 12)"/>`).join('')}<circle cx="12" cy="12" r="3.2" fill="${mid}"/></svg>`;
  const star = c => `<svg viewBox="0 0 24 24"><path d="M12 2l2.9 6.1 6.6.9-4.8 4.6 1.2 6.6L12 17l-5.9 3.2 1.2-6.6L2.5 9l6.6-.9z" fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  const doodles = [
    ['l', 12, heart('#e8918a'), 22], ['l', 34, sparkle('#e6b54a'), 16], ['l', 58, flower('#f2b8a2', '#e6b54a'), 22], ['l', 82, star('#d9694a'), 18],
    ['r', 20, sparkle('#e6b54a'), 14], ['r', 42, flower('#e8918a', '#f6d9b8'), 20], ['r', 66, heart('#d9694a'), 18], ['r', 88, sparkle('#8fae7c'), 16],
  ];
  add(page, 'page-doodles', doodles.map(([side, top, svg, size], i) =>
    `<span class="${side}" style="top:${top}%;width:${size}px;animation-delay:${(-i * 0.9).toFixed(1)}s">${svg}</span>`).join(''));

  // Measure page: a tailor's tape measure over the mannequin card, and a tomato pin cushion.
  const figure = document.querySelector('.figure-panel');
  if (figure) {
    add(figure, 'deco-tape', '<svg viewBox="0 0 70 240"><path d="M2 22C22 16 40 14 50 20s12 22 11 50c-1 40 2 90-4 150" fill="none" stroke="#e9c46a" stroke-width="13" stroke-linecap="butt"/><path d="M2 22C22 16 40 14 50 20s12 22 11 50c-1 40 2 90-4 150" fill="none" stroke="#8a6420" stroke-width="5" stroke-dasharray="1 5" opacity=".75"/><rect x="50" y="218" width="14" height="10" rx="1.5" fill="#b8914c" transform="rotate(-4 57 223)"/></svg>');
    add(figure, 'deco-cushion', '<svg viewBox="0 0 64 60"><path d="M22 20l-6-14M32 18V2M42 20l7-13M27 19l-12 2M38 19l12-1" stroke="#9aa3aa" stroke-width="1.4" stroke-linecap="round"/><circle cx="16" cy="6" r="3" fill="#e6b54a"/><circle cx="32" cy="3" r="3" fill="#8fae7c"/><circle cx="49" cy="7" r="3" fill="#e8918a"/><circle cx="15" cy="21" r="2.6" fill="#7aa0c8"/><circle cx="50" cy="18" r="2.6" fill="#f3e3cf"/><ellipse cx="32" cy="40" rx="26" ry="18" fill="#d9533b"/><path d="M32 22c-4 8-4 28 0 36M32 22c4 8 4 28 0 36M14 28c6 6 8 20 4 28M50 28c-6 6-8 20-4 28" stroke="#b8402b" stroke-width="1.4" fill="none" opacity=".7"/><ellipse cx="22" cy="33" rx="6" ry="3" fill="#fff" opacity=".22"/><path d="M32 18l3 5 6-1-4 4 3 5-8-3-8 3 3-5-4-4 6 1z" fill="#6f8f5e"/></svg>');
  }

  // Try-on page: the model's stage is a little fitting room. Curtains tied back on both sides of a brass rail,
  // a pendant lamp, a plant on the floor, and a wooden "Fitting Room" sign. Pressing the sign changes the
  // backdrop (it always starts on the original studio one); the curtains change colour to match.
  const stage = document.getElementById('dropzone');
  if (stage) {
    const CURTAIN = '<svg viewBox="0 0 40 400" preserveAspectRatio="none"><path d="M0 0h40c-2 60-6 150-18 250 10 40 16 90 18 150H0z" fill="currentColor"/>'
      + '<path d="M9 0c0 90 4 170 7 250M20 0c-1 90-2 170-2 250M31 0c-3 90-8 170-10 250M10 400c2-50 5-110 8-150M24 400c0-50-1-110-4-150" fill="none" stroke="rgba(0,0,0,.2)" stroke-width="2.4"/>'
      + '<path d="M14 0c0 90 3 170 5 250M26 0c-2 90-4 170-5 250M17 400c1-50 2-110 3-150" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1.6"/></svg>';
    const TIE = '<svg viewBox="0 0 30 40"><rect x="1" y="3" width="28" height="7" rx="3.5" fill="#d9b36a"/><rect x="1" y="3" width="28" height="3" rx="1.5" fill="#efd9a6"/><circle cx="15" cy="12" r="3.2" fill="#b8914c"/><path d="M11 14h8l2 22c-3 3-9 3-12 0z" fill="#d9b36a"/><path d="M13 16v19M15 16v20M17 16v19" stroke="#b8914c" stroke-width=".7"/></svg>';
    add(stage, 'deco-curtain l', CURTAIN);
    add(stage, 'deco-curtain r', CURTAIN);
    add(stage, 'deco-tie l', TIE);
    add(stage, 'deco-tie r', TIE);
    add(stage, 'deco-rail', '<i></i>');
    add(stage, 'deco-lamp', '<svg viewBox="0 0 40 70"><path d="M20 0v34" stroke="#8c6a2e" stroke-width="1.2"/><path d="M7 48c0-9 6-14 13-14s13 5 13 14z" fill="#e8c9a0"/><path d="M7 48c0-9 6-14 13-14s13 5 13 14z" fill="rgba(0,0,0,.08)"/><path d="M11 45c1-5 4-8 7-9" stroke="#fff" stroke-width="1.5" opacity=".5" fill="none" stroke-linecap="round"/><ellipse cx="20" cy="49" rx="5" ry="3.5" fill="#fff4cf"/></svg><i class="glow"></i>');
    add(stage, 'deco-stage-plant', PLANT);

    const ROOMS = [
      { id: '', name: 'Studio' },
      { id: 'blush', name: 'Blush wallpaper' },
      { id: 'garden', name: 'Garden trellis' },
      { id: 'arch', name: 'Terracotta arch' },
      { id: 'night', name: 'Starry night' },
      { id: 'seaside', name: 'Maldives beach' },
    ];
    let room = 0;
    const sign = document.createElement('button');
    sign.type = 'button';
    sign.className = 'deco-sign';
    sign.innerHTML = '<span class="board">Fitting Room <b>♡</b><span class="swap" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.5 6.5A4.8 4.8 0 0 1 12 4.6M12.5 9.5A4.8 4.8 0 0 1 4 11.4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M12.6 1.8v3.3H9.3M3.4 14.2v-3.3h3.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span></span><span class="room-name" aria-live="polite"></span>';
    const label = () => `Change the fitting room background. Now: ${ROOMS[room].name}.`;
    sign.setAttribute('aria-label', label());
    sign.title = 'Change the background';
    // Don't let a press on the sign turn the model or start a drag underneath it.
    sign.addEventListener('pointerdown', e => e.stopPropagation());
    let nameTimer = 0;
    sign.addEventListener('click', e => {
      e.stopPropagation();
      room = (room + 1) % ROOMS.length;
      if (ROOMS[room].id) stage.dataset.room = ROOMS[room].id; else delete stage.dataset.room;
      sign.setAttribute('aria-label', label());
      const name = sign.querySelector('.room-name');
      name.textContent = ROOMS[room].name;
      sign.classList.remove('flip'); void sign.offsetWidth; sign.classList.add('flip');
      clearTimeout(nameTimer);
      nameTimer = setTimeout(() => sign.classList.remove('flip'), 1600);
    });
    stage.appendChild(sign);
  }
})();
