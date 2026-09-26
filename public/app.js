/* Shared logic for the 3-page fit flow:
 *   - body silhouette SVG with measurable regions
 *   - demo garment catalogue (size charts are placeholders, garment circumferences in cm)
 *   - fit check: ease per region -> good / warn / bad, recommended size, English summary
 */
(function () {
  const STORE_KEY = 'fit.body';

  // From data/scans/demo.json (Bodygram stats-only scan), converted mm -> cm.
  const DEMO_BODY = { height: 175, chest: 91.4, waist: 77.9, hip: 93.5, inseam: 79.7, shoulder: 46.7 };

  const FIELDS = [
    { key: 'height',   label: 'Height',        hint: 'Standing straight, no shoes',             min: 120, max: 230 },
    { key: 'chest',    label: 'Chest',         hint: 'Around the fullest part of your chest',   min: 60,  max: 160 },
    { key: 'waist',    label: 'Waist',         hint: 'Around your natural waist, above the navel', min: 50, max: 160 },
    { key: 'hip',      label: 'Hips',          hint: 'Around the widest part of your hips',     min: 60,  max: 170 },
    { key: 'inseam',   label: 'Inseam',        hint: 'Crotch to the floor, inside of the leg',  min: 50,  max: 110 },
    { key: 'shoulder', label: 'Shoulder width', hint: 'Across your back, shoulder tip to tip',  min: 30,  max: 65 },
  ];

  const SIZE_NAMES = { XS: 'Extra Small', S: 'Small', M: 'Medium', L: 'Large', XL: 'Extra Large' };

  // How each region reads in plain English.
  const REGION_TEXT = {
    chest:    { label: 'Chest',     noun: 'chest',       where: 'at the chest',     kind: 'girth' },
    waist:    { label: 'Waist',     noun: 'waist',       where: 'at the waist',     kind: 'girth' },
    hip:      { label: 'Hips',      noun: 'hips',        where: 'through the hips', kind: 'girth' },
    shoulder: { label: 'Shoulders', noun: 'shoulders',   where: 'in the shoulders', kind: 'width' },
    inseam:   { label: 'Inseam',    noun: 'leg length',  where: 'in the leg',       kind: 'length' },
  };

  // ---------- Body silhouette ----------
  // viewBox 0 0 200 440, front view, feet at y=422.
  const BODY_PATH =
    'M90 60 L90 74 C78 78 60 78 52 86 C44 92 42 104 41 118 L36 180 L32 238 ' +
    'C30 250 34 260 40 258 C44 256 46 248 46 240 L52 184 L58 132 ' +
    'C60 150 66 162 70 172 C66 190 62 204 62 216 L68 330 L74 410 L68 422 L94 422 L94 410 ' +
    'L96 330 L100 246 L104 330 L106 410 L106 422 L132 422 L126 410 L132 330 L138 216 ' +
    'C138 204 134 190 130 172 C134 162 140 150 142 132 L148 184 L154 240 ' +
    'C154 248 156 256 160 258 C166 260 170 250 168 238 L164 180 L159 118 ' +
    'C158 104 156 92 148 86 C140 78 122 78 110 74 L110 60 Z';

  // Region bands (clipped to the silhouette) + the tape-measure line drawn for each.
  const REGIONS = {
    height:   { rect: [0, 0, 200, 440],   line: 'M184 14 L184 422', caps: 'M178 14 L190 14 M178 422 L190 422' },
    shoulder: { rect: [38, 74, 124, 26],  line: 'M52 86 L148 86' },
    chest:    { rect: [56, 100, 88, 46],  line: 'M58 120 L142 120' },
    waist:    { rect: [58, 146, 84, 44],  line: 'M68 172 L132 172' },
    hip:      { rect: [58, 190, 84, 54],  line: 'M62 218 L138 218' },
    inseam:   { rect: [62, 244, 76, 180], line: 'M100 250 L100 420', caps: 'M94 250 L106 250 M94 420 L106 420' },
  };

  let figureCount = 0;
  function bodyFigure(label) {
    const id = 'bodyclip' + (++figureCount);
    const regions = Object.entries(REGIONS).map(([key, r]) => {
      const [x, y, w, h] = r.rect;
      return `<g class="region" data-region="${key}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></g>`;
    }).join('');
    const lines = Object.entries(REGIONS).map(([key, r]) =>
      `<path class="measure" data-region="${key}" d="${r.line}"/>` +
      (r.caps ? `<path class="measure cap" data-region="${key}" d="${r.caps}"/>` : '')
    ).join('');
    return `
<svg class="body-figure" viewBox="0 0 200 440" role="img" aria-label="${label || 'Body outline'}">
  <defs><clipPath id="${id}"><path d="${BODY_PATH}"/><ellipse cx="100" cy="36" rx="21" ry="25"/></clipPath></defs>
  <ellipse class="silhouette" cx="100" cy="36" rx="21" ry="25"/>
  <path class="silhouette" d="${BODY_PATH}"/>
  <g clip-path="url(#${id})">${regions}</g>
  ${lines}
</svg>`;
  }

  // ---------- Garment artwork (simple flat illustrations) ----------
  const shade = 'rgba(0,0,0,.22)';
  const light = 'rgba(255,255,255,.35)';
  const LONG_SLEEVE = 'M74 30 L54 38 L40 62 L28 156 L46 160 L58 88 L58 182 L142 182 L142 88 L154 160 L172 156 L160 62 L146 38 L126 30';
  const ART = {
    tee: c => `<svg viewBox="0 0 200 200" aria-hidden="true">
      <path d="M72 32 L52 40 L22 64 L38 90 L58 80 L58 178 L142 178 L142 80 L162 90 L178 64 L148 40 L128 32 C120 46 80 46 72 32 Z" fill="${c}"/>
      <path d="M72 32 C80 46 120 46 128 32" fill="none" stroke="${shade}" stroke-width="4"/>
      <path d="M58 80 L60 46 M142 80 L140 46" fill="none" stroke="${shade}" stroke-width="2"/></svg>`,
    shirt: c => `<svg viewBox="0 0 200 200" aria-hidden="true">
      <path d="${LONG_SLEEVE} L100 56 Z" fill="${c}"/>
      <path d="M74 30 L88 54 L100 56 L112 54 L126 30 L116 24 L100 40 L84 24 Z" fill="${c}"/>
      <path d="M74 30 L88 54 L100 56 L112 54 L126 30 L116 24 L100 40 L84 24 Z" fill="${light}"/>
      <path d="M100 56 L100 182" stroke="${shade}" stroke-width="2"/>
      ${[74, 98, 122, 146, 170].map(y => `<circle cx="104" cy="${y}" r="2.6" fill="${shade}"/>`).join('')}
      <rect x="112" y="78" width="18" height="20" rx="2" fill="none" stroke="${shade}" stroke-width="2"/>
      <path d="M30 144 L47 148 M170 144 L153 148 M58 88 L60 44 M142 88 L140 44" stroke="${shade}" stroke-width="2"/></svg>`,
    hoodie: c => `<svg viewBox="0 0 200 200" aria-hidden="true">
      <path d="M68 40 C60 4 140 4 132 40 Z" fill="${c}"/><path d="M68 40 C60 4 140 4 132 40 Z" fill="${shade}"/>
      <path d="${LONG_SLEEVE} C118 44 82 44 74 30 Z" fill="${c}"/>
      <path d="M80 30 C80 12 120 12 120 30 C114 42 86 42 80 30 Z" fill="rgba(0,0,0,.35)"/>
      <path d="M92 40 L90 78 M108 40 L110 78" stroke="${light}" stroke-width="2.5" stroke-linecap="round"/>
      <path d="M100 42 L100 182" stroke="${shade}" stroke-width="2"/>
      <path d="M70 128 L130 128 L138 162 L62 162 Z" fill="none" stroke="${shade}" stroke-width="2.5"/>
      <rect x="58" y="172" width="84" height="10" fill="${shade}"/>
      <path d="M29 146 L47 150 M171 146 L153 150" stroke="${shade}" stroke-width="3"/></svg>`,
    jacket: c => `<svg viewBox="0 0 200 200" aria-hidden="true">
      <path d="M72 28 L50 36 L36 60 L24 158 L46 162 L56 90 L56 184 L144 184 L144 90 L154 162 L176 158 L164 60 L150 36 L128 28 Z" fill="${c}"/>
      <rect x="74" y="16" width="52" height="18" rx="6" fill="${c}"/><rect x="74" y="16" width="52" height="18" rx="6" fill="${shade}"/>
      ${[62, 88, 114, 140, 166].map(y => `<path d="M56 ${y} Q100 ${y + 6} 144 ${y}" fill="none" stroke="${shade}" stroke-width="2"/>`).join('')}
      ${[78, 104, 130].map(y => `<path d="M${40 - (y - 78) / 6} ${y} L56 ${y + 2} M${160 + (y - 78) / 6} ${y} L144 ${y + 2}" stroke="${shade}" stroke-width="2"/>`).join('')}
      <path d="M100 16 L100 184" stroke="${light}" stroke-width="3"/></svg>`,
    jeans: c => `<svg viewBox="0 0 200 200" aria-hidden="true">
      <path d="M60 16 L140 16 L148 186 L110 186 L100 74 L90 186 L52 186 Z" fill="${c}"/>
      <rect x="60" y="16" width="80" height="12" fill="${shade}"/>
      <path d="M100 28 C100 48 98 58 94 66" fill="none" stroke="${shade}" stroke-width="2"/>
      <path d="M64 28 C68 44 78 48 86 28 M136 28 C132 44 122 48 114 28" fill="none" stroke="rgba(240,190,110,.8)" stroke-width="2" stroke-dasharray="3 3"/>
      <path d="M58 176 L90 176 M110 176 L146 176" stroke="rgba(240,190,110,.8)" stroke-width="2" stroke-dasharray="3 3"/></svg>`,
    chinos: c => `<svg viewBox="0 0 200 200" aria-hidden="true">
      <path d="M58 16 L142 16 L152 186 L110 186 L100 76 L90 186 L48 186 Z" fill="${c}"/>
      <rect x="58" y="16" width="84" height="12" fill="${shade}"/>
      ${[72, 84, 116, 128].map(x => `<rect x="${x - 2}" y="14" width="4" height="16" fill="${shade}"/>`).join('')}
      <path d="M62 28 L76 52 M138 28 L124 52" stroke="${shade}" stroke-width="2"/>
      <path d="M74 60 L70 186 M126 60 L130 186" stroke="${light}" stroke-width="2"/></svg>`,
  };

  // ---------- Demo catalogue ----------
  // Size charts are hand-made placeholders (garment circumference / width / inseam in cm).
  // rules: ease = garment - body. Inside `good` -> green, inside `ok` -> yellow, outside -> red.
  const GARMENTS = [
    {
      id: 'crew-tee', name: 'Essential Crew Tee', brand: 'Zara', art: 'tee', color: '#2f4858', bg: '#e1eaee',
      fabric: '100% cotton jersey, low stretch',
      rules: { chest: { good: [5, 14], ok: [1, 20] }, waist: { good: [4, 16], ok: [0, 24] }, shoulder: { good: [-1, 3], ok: [-3, 5] } },
      sizes: { S: { chest: 96, waist: 92, shoulder: 44 }, M: { chest: 102, waist: 98, shoulder: 46 }, L: { chest: 108, waist: 104, shoulder: 48 }, XL: { chest: 114, waist: 110, shoulder: 50 } },
    },
    {
      id: 'oxford-shirt', name: 'Oxford Button-Down Shirt', brand: 'Hollister', art: 'shirt', color: '#8fb0d8', bg: '#e8eef6',
      fabric: '100% cotton oxford, no stretch',
      rules: { chest: { good: [8, 16], ok: [3, 22] }, waist: { good: [6, 18], ok: [2, 26] }, shoulder: { good: [-1, 2], ok: [-3, 4] } },
      sizes: { S: { chest: 98, waist: 88, shoulder: 44.5 }, M: { chest: 104, waist: 94, shoulder: 46.5 }, L: { chest: 110, waist: 100, shoulder: 48.5 }, XL: { chest: 116, waist: 106, shoulder: 50.5 } },
    },
    {
      id: 'club-hoodie', name: 'Club Fleece Hoodie', brand: 'Nike', art: 'hoodie', color: '#44464c', bg: '#ebebea',
      fabric: '80% cotton, 20% polyester fleece',
      rules: { chest: { good: [4, 16], ok: [-2, 22] }, waist: { good: [2, 18], ok: [-2, 26] }, shoulder: { good: [-2, 4], ok: [-4, 6] } },
      sizes: { S: { chest: 94, waist: 88, shoulder: 45 }, M: { chest: 100, waist: 94, shoulder: 47 }, L: { chest: 106, waist: 100, shoulder: 49 }, XL: { chest: 112, waist: 106, shoulder: 51 } },
    },
    {
      id: 'puffer-jacket', name: 'Quilted Puffer Jacket', brand: 'Hollister', art: 'jacket', color: '#b5462f', bg: '#f5e6e0',
      fabric: 'Nylon shell, recycled polyester fill',
      rules: { chest: { good: [12, 22], ok: [8, 28] }, waist: { good: [10, 26], ok: [4, 32] }, shoulder: { good: [0, 4], ok: [-2, 6] } },
      sizes: { S: { chest: 102, waist: 98, shoulder: 45 }, M: { chest: 108, waist: 104, shoulder: 47 }, L: { chest: 114, waist: 110, shoulder: 49 }, XL: { chest: 120, waist: 116, shoulder: 51 } },
    },
    {
      id: 'slim-jeans', name: 'Slim Fit Jeans', brand: 'Zara', art: 'jeans', color: '#3a5a86', bg: '#e3e9f2',
      fabric: '98% cotton, 2% elastane',
      rules: { waist: { good: [0, 3], ok: [-2, 6] }, hip: { good: [2, 8], ok: [-1, 12] }, inseam: { good: [-2, 2], ok: [-5, 5] } },
      sizes: { S: { waist: 74, hip: 92, inseam: 76 }, M: { waist: 78, hip: 96, inseam: 77 }, L: { waist: 82, hip: 100, inseam: 80 }, XL: { waist: 86, hip: 104, inseam: 81 } },
    },
    {
      id: 'relaxed-chinos', name: 'Relaxed Chino Trousers', brand: 'Nike', art: 'chinos', color: '#c2a676', bg: '#f3eee3',
      fabric: '97% cotton twill, 3% elastane',
      rules: { waist: { good: [0, 4], ok: [-2, 7] }, hip: { good: [6, 14], ok: [2, 20] }, inseam: { good: [-2, 2], ok: [-5, 5] } },
      sizes: { S: { waist: 76, hip: 100, inseam: 76 }, M: { waist: 80, hip: 104, inseam: 78 }, L: { waist: 84, hip: 108, inseam: 80 }, XL: { waist: 88, hip: 112, inseam: 82 } },
    },
  ];

  function garmentArt(g) { return ART[g.art](g.color); }
  function getGarment(id) { return GARMENTS.find(g => g.id === id) || null; }

  // ---------- Fit check ----------
  const PHRASES = {
    girth:  { lowWarn: 'slightly snug', lowBad: 'too tight', highWarn: 'a little relaxed', highBad: 'too loose',
              chip: { good: 'Good fit', lowWarn: 'Snug', lowBad: 'Too tight', highWarn: 'Relaxed', highBad: 'Too loose' } },
    width:  { lowWarn: 'slightly narrow', lowBad: 'too narrow', highWarn: 'slightly wide', highBad: 'too wide',
              chip: { good: 'Good fit', lowWarn: 'Narrow', lowBad: 'Too narrow', highWarn: 'Wide', highBad: 'Too wide' } },
    length: { lowWarn: 'a little short', lowBad: 'too short', highWarn: 'a little long', highBad: 'too long',
              chip: { good: 'Good length', lowWarn: 'A bit short', lowBad: 'Too short', highWarn: 'A bit long', highBad: 'Too long' } },
  };

  function judgeRegion(key, ease, rule) {
    const t = REGION_TEXT[key];
    const p = PHRASES[t.kind];
    const [g0, g1] = rule.good, [o0, o1] = rule.ok;
    let level = 'good', dir = null;
    if (ease < g0 || ease > g1) {
      level = ease >= o0 && ease <= o1 ? 'warn' : 'bad';
      dir = ease < g0 ? 'low' : 'high';
    }
    const code = dir ? dir + (level === 'warn' ? 'Warn' : 'Bad') : 'good';
    return {
      key, label: t.label, noun: t.noun, ease: Math.round(ease * 10) / 10, level,
      chip: p.chip[code], phrase: dir ? `${p[code]} ${t.where}` : null,
      distance: Math.abs(ease - (g0 + g1) / 2) / Math.max(1, g1 - g0),
    };
  }

  function checkSize(g, body, size) {
    const chart = g.sizes[size];
    const regions = Object.keys(g.rules).map(k => judgeRegion(k, chart[k] - body[k], g.rules[k]));
    const penalty = regions.reduce((s, r) => s + (r.level === 'bad' ? 10 : r.level === 'warn' ? 3 : 0) + r.distance * 0.1, 0);
    const worst = regions.some(r => r.level === 'bad') ? 'bad' : regions.some(r => r.level === 'warn') ? 'warn' : 'good';
    return { size, regions, penalty, worst, summary: summarize(size, regions) };
  }

  function fitReport(g, body) {
    const sizes = {};
    for (const s of Object.keys(g.sizes)) sizes[s] = checkSize(g, body, s);
    const recommended = Object.values(sizes).sort((a, b) => a.penalty - b.penalty)[0].size;
    return { recommended, sizes };
  }

  function joinList(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  function summarize(size, regions) {
    const name = SIZE_NAMES[size] || size;
    const good = regions.filter(r => r.level === 'good').map(r => r.noun);
    const issues = regions.filter(r => r.level !== 'good');
    const hasBad = issues.some(r => r.level === 'bad');
    if (!issues.length) return `${name} is a great match, fitting well through the ${joinList(good)}.`;
    const issueText = joinList(issues.map(r => r.phrase));
    if (!good.length) return `${name} is the closest size, but it is ${issueText}.`;
    return `${name} fits well through the ${joinList(good)}, ${hasBad ? 'but is' : 'and is'} ${issueText}.`;
  }

  // ---------- Storage (per-viewer convenience only) ----------
  function saveBody(body) { try { localStorage.setItem(STORE_KEY, JSON.stringify(body)); } catch (e) { /* ignore */ } }
  function loadBody() {
    try {
      const b = JSON.parse(localStorage.getItem(STORE_KEY));
      if (b && FIELDS.every(f => typeof b[f.key] === 'number' && b[f.key] > 0)) return b;
    } catch (e) { /* ignore */ }
    return null;
  }

  window.Fit = {
    FIELDS, DEMO_BODY, SIZE_NAMES, GARMENTS,
    bodyFigure, garmentArt, getGarment, fitReport, saveBody, loadBody,
  };
})();
