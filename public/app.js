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

  // ---------- Body figure ----------
  // viewBox 0 0 200 440, front view, feet at y≈426. Landmarks the regions rely on:
  // shoulders y≈90, chest y≈120, waist y≈170, hips y≈216, crotch y≈248.
  const TORSO =
    'M93 54 C93 62 92 68 90 70 C82 74 70 76 62 79 C54 82 50 88 50 96 L60 122 ' +
    'C61 138 64 152 69 168 C71 178 66 192 63 206 C61 214 61 222 62 232 ' +
    'C64 262 68 300 70 330 C71 350 69 372 72 395 C73 405 74 410 74 414 ' +
    'C70 418 64 420 64 424 C64 427 90 427 92 424 C92 418 90 414 90 410 ' +
    'C90 390 94 360 93 336 C94 300 97 270 100 250 C103 270 106 300 107 336 ' +
    'C106 360 110 390 110 410 C110 414 108 418 108 424 C110 427 136 427 136 424 ' +
    'C136 420 130 418 126 414 C126 410 127 405 128 395 C131 372 129 350 130 330 ' +
    'C132 300 136 262 138 232 C139 222 139 214 137 206 C134 192 129 178 131 168 ' +
    'C136 152 139 138 140 122 L150 96 C150 88 146 82 138 79 C130 76 118 74 110 70 ' +
    'C108 68 107 62 107 54 Z';
  const ARM_L =
    'M58 84 C48 86 44 94 43 104 C41 124 38 144 36 164 C34 184 31 204 29 222 ' +
    'C27 230 25 240 27 248 C29 256 36 256 38 250 C40 244 39 236 39 228 ' +
    'C42 210 46 190 48 170 C50 152 54 136 58 124 Z';
  const ARM_R = ARM_L.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (m, x, y) => `${200 - x} ${y}`);
  const HEAD = '<ellipse cx="100" cy="34" rx="19" ry="23"/>';
  // Soft inner lines that give the figure some shape.
  const DETAILS =
    'M86 76 C92 80 96 80 99 78 M114 76 C108 80 104 80 101 78 ' +          // collarbones
    'M78 128 C86 134 94 134 99 131 M122 128 C114 134 106 134 101 131 ' + // chest
    'M100 150 L100 158 ' +                                                // navel line
    'M76 334 C79 338 84 338 87 334 M113 334 C116 338 121 338 124 334';   // knees
  const ELBOW_L = 'M39 166 C41 168 44 168 46 166';
  const ELBOW_R = 'M161 166 C159 168 156 168 154 166';

  // Region bands (clipped to the body) — used for highlight on page 1 and fit colours on page 3.
  const REGIONS = {
    height:   [0, 0, 200, 440],
    shoulder: [24, 74, 152, 26],
    chest:    [56, 100, 88, 46],
    waist:    [58, 146, 84, 44],
    hip:      [58, 190, 84, 54],
    inseam:   [62, 244, 76, 184],
  };

  // Measuring tapes shown on page 1. Girths wrap round the body (front solid, back dashed).
  const ring = (cy, rx, ry) => ({
    back: `M${100 - rx} ${cy} A${rx} ${ry} 0 0 1 ${100 + rx} ${cy}`,
    front: `M${100 - rx} ${cy} A${rx} ${ry} 0 0 0 ${100 + rx} ${cy}`,
  });
  const TAPES = {
    chest:    { ...ring(120, 45, 7), tag: [100, 132] },
    waist:    { ...ring(170, 34, 5), tag: [100, 180] },
    hip:      { ...ring(216, 41, 7), tag: [100, 228] },
    shoulder: { front: 'M50 92 L150 92', caps: 'M50 86 L50 98 M150 86 L150 98', tag: [100, 100] },
    height:   { front: 'M186 10 L186 426', caps: 'M180 10 L192 10 M180 426 L192 426', arrows: true, tag: [100, 282] },
    inseam:   { front: 'M100 252 L100 424', caps: 'M95 252 L105 252 M95 424 L105 424', arrows: true, tag: [100, 300] },
  };

  let figureCount = 0;
  function bodyFigure(label) {
    const n = ++figureCount;
    const id = s => `${s}${n}`;
    const regions = Object.entries(REGIONS).map(([key, [x, y, w, h]]) =>
      `<g class="region" data-region="${key}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></g>`).join('');
    const tapes = Object.entries(TAPES).map(([key, t]) => `
      <g class="tape" data-region="${key}">
        ${t.back ? `<path class="tape-back" d="${t.back}"/>` : ''}
        <path class="tape-front" d="${t.front}" pathLength="100"${t.arrows ? ` marker-start="url(#${id('arrow')})" marker-end="url(#${id('arrow')})"` : ''}/>
        <path class="tape-ticks" d="${t.front}"/>
        ${t.caps ? `<path class="tape-caps" d="${t.caps}"/>` : ''}
        <g class="value-tag" transform="translate(${t.tag[0] - 32} ${t.tag[1]})"><rect width="64" height="24" rx="12"/><text x="32" y="17"></text></g>
      </g>`).join('');
    const parts = `<path d="${ARM_L}"/><path d="${ARM_R}"/><path d="${TORSO}"/>${HEAD}`;
    return `
<svg class="body-figure" viewBox="0 0 200 440" role="img" aria-label="${label || 'Body outline'}">
  <defs>
    <linearGradient id="${id('skin')}" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" class="skin-light"/><stop offset=".55" class="skin-mid"/><stop offset="1" class="skin-dark"/>
    </linearGradient>
    <clipPath id="${id('clip')}">${parts}</clipPath>
    <marker id="${id('arrow')}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 Z" class="tape-arrow"/>
    </marker>
  </defs>
  <ellipse class="floor-shadow" cx="100" cy="428" rx="50" ry="6"/>
  <g class="figure-body">
    <g class="arm arm-l"><path class="outline" d="${ARM_L}"/><path class="skin" fill="url(#${id('skin')})" d="${ARM_L}"/><path class="details" d="${ELBOW_L}"/></g>
    <g class="arm arm-r"><path class="outline" d="${ARM_R}"/><path class="skin" fill="url(#${id('skin')})" d="${ARM_R}"/><path class="details" d="${ELBOW_R}"/></g>
    <path class="outline" d="${TORSO}"/>
    <path class="skin" fill="url(#${id('skin')})" d="${TORSO}"/>
    <path class="details" d="${DETAILS}"/>
    <g class="head">
      <ellipse class="outline" cx="100" cy="34" rx="19" ry="23"/>
      <ellipse class="skin" fill="url(#${id('skin')})" cx="100" cy="34" rx="19" ry="23"/>
      <path class="hair" d="M80 34 C78 14 90 8 101 8 C113 8 123 16 120 34 C117 26 112 21 104 20 C98 24 88 25 80 34 Z"/>
      <g class="eyes"><ellipse cx="93" cy="36" rx="1.8" ry="2.2"/><ellipse cx="107" cy="36" rx="1.8" ry="2.2"/></g>
      <path class="smile" d="M94.5 44 Q100 48 105.5 44"/>
      <ellipse class="blush" cx="89" cy="42" rx="3.5" ry="2"/><ellipse class="blush" cx="111" cy="42" rx="3.5" ry="2"/>
    </g>
    <g class="sparkles">
      <path d="M58 20 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 Z"/>
      <path d="M140 8 l2.2 5 5 2.2 -5 2.2 -2.2 5 -2.2 -5 -5 -2.2 5 -2.2 Z"/>
      <path d="M146 50 l1.8 4 4 1.8 -4 1.8 -1.8 4 -1.8 -4 -4 -1.8 4 -1.8 Z"/>
      <path d="M50 62 l1.5 3.4 3.4 1.5 -3.4 1.5 -1.5 3.4 -1.5 -3.4 -3.4 -1.5 3.4 -1.5 Z"/>
    </g>
    <g class="region-layer" clip-path="url(#${id('clip')})">${regions}</g>
    ${tapes}
  </g>
</svg>`;
  }

  /** Put a value (e.g. "91 cm") on the tape tag of one region. */
  function setFigureValue(root, key, text) {
    const t = root.querySelector(`.tape[data-region="${key}"] .value-tag text`);
    if (t) t.textContent = text || '';
    const tag = t && t.closest('.value-tag');
    if (tag) tag.classList.toggle('empty', !text);
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
      id: 'crew-tee', category: 'top', price: '$19.90', name: 'Essential Crew Tee', brand: 'Zara', art: 'tee', color: '#2f4858', bg: '#e1eaee',
      fabric: '100% cotton jersey, low stretch',
      rules: { chest: { good: [5, 14], ok: [1, 20] }, waist: { good: [4, 16], ok: [0, 24] }, shoulder: { good: [-1, 3], ok: [-3, 5] } },
      sizes: { S: { chest: 96, waist: 92, shoulder: 44 }, M: { chest: 102, waist: 98, shoulder: 46 }, L: { chest: 108, waist: 104, shoulder: 48 }, XL: { chest: 114, waist: 110, shoulder: 50 } },
    },
    {
      id: 'oxford-shirt', category: 'top', price: '$44.00', name: 'Oxford Button-Down Shirt', brand: 'Hollister', art: 'shirt', color: '#8fb0d8', bg: '#e8eef6',
      fabric: '100% cotton oxford, no stretch',
      rules: { chest: { good: [8, 16], ok: [3, 22] }, waist: { good: [6, 18], ok: [2, 26] }, shoulder: { good: [-1, 2], ok: [-3, 4] } },
      sizes: { S: { chest: 98, waist: 88, shoulder: 44.5 }, M: { chest: 104, waist: 94, shoulder: 46.5 }, L: { chest: 110, waist: 100, shoulder: 48.5 }, XL: { chest: 116, waist: 106, shoulder: 50.5 } },
    },
    {
      id: 'club-hoodie', category: 'top', price: '$55.00', name: 'Club Fleece Hoodie', brand: 'Nike', art: 'hoodie', color: '#44464c', bg: '#ebebea',
      fabric: '80% cotton, 20% polyester fleece',
      rules: { chest: { good: [4, 16], ok: [-2, 22] }, waist: { good: [2, 18], ok: [-2, 26] }, shoulder: { good: [-2, 4], ok: [-4, 6] } },
      sizes: { S: { chest: 94, waist: 88, shoulder: 45 }, M: { chest: 100, waist: 94, shoulder: 47 }, L: { chest: 106, waist: 100, shoulder: 49 }, XL: { chest: 112, waist: 106, shoulder: 51 } },
    },
    {
      id: 'puffer-jacket', category: 'top', price: '$89.00', name: 'Quilted Puffer Jacket', brand: 'Hollister', art: 'jacket', color: '#b5462f', bg: '#f5e6e0',
      fabric: 'Nylon shell, recycled polyester fill',
      rules: { chest: { good: [12, 22], ok: [8, 28] }, waist: { good: [10, 26], ok: [4, 32] }, shoulder: { good: [0, 4], ok: [-2, 6] } },
      sizes: { S: { chest: 102, waist: 98, shoulder: 45 }, M: { chest: 108, waist: 104, shoulder: 47 }, L: { chest: 114, waist: 110, shoulder: 49 }, XL: { chest: 120, waist: 116, shoulder: 51 } },
    },
    {
      id: 'slim-jeans', category: 'bottom', price: '$49.90', name: 'Slim Fit Jeans', brand: 'Zara', art: 'jeans', color: '#3a5a86', bg: '#e3e9f2',
      fabric: '98% cotton, 2% elastane',
      rules: { waist: { good: [0, 3], ok: [-2, 6] }, hip: { good: [2, 8], ok: [-1, 12] }, inseam: { good: [-2, 2], ok: [-5, 5] } },
      sizes: { S: { waist: 74, hip: 92, inseam: 76 }, M: { waist: 78, hip: 96, inseam: 77 }, L: { waist: 82, hip: 100, inseam: 80 }, XL: { waist: 86, hip: 104, inseam: 81 } },
    },
    {
      id: 'relaxed-chinos', category: 'bottom', price: '$60.00', name: 'Relaxed Chino Trousers', brand: 'Nike', art: 'chinos', color: '#c2a676', bg: '#f3eee3',
      fabric: '97% cotton twill, 3% elastane',
      rules: { waist: { good: [0, 4], ok: [-2, 7] }, hip: { good: [6, 14], ok: [2, 20] }, inseam: { good: [-2, 2], ok: [-5, 5] } },
      sizes: { S: { waist: 76, hip: 100, inseam: 76 }, M: { waist: 80, hip: 104, inseam: 78 }, L: { waist: 84, hip: 108, inseam: 80 }, XL: { waist: 88, hip: 112, inseam: 82 } },
    },
  ];

  function garmentArt(g) { return ART[g.art](g.color); }
  function getGarment(id) { return GARMENTS.find(g => g.id === id) || loadCustom().find(g => g.id === id) || null; }

  // ---------- Items from a pasted product link ----------
  // We can't read a store's size chart from the browser, so a pasted item borrows the
  // standard chart of the same garment type (from the demo catalogue) and is labelled as an estimate.
  const CUSTOM_KEY = 'fit.custom';
  const TYPES = [
    { art: 'jeans',  label: 'Jeans',             category: 'bottom', words: ['jean', 'denim'] },
    { art: 'chinos', label: 'Trousers / chinos', category: 'bottom', words: ['chino', 'trouser', 'pant', 'jogger', 'slack', 'cargo', 'short'] },
    { art: 'hoodie', label: 'Hoodie / sweatshirt', category: 'top',  words: ['hoodie', 'hooded', 'sweatshirt', 'sweater', 'jumper', 'cardigan', 'knit', 'fleece'] },
    { art: 'jacket', label: 'Jacket / coat',     category: 'top',    words: ['jacket', 'coat', 'puffer', 'parka', 'blazer', 'bomber', 'gilet', 'anorak', 'overshirt'] },
    { art: 'tee',    label: 'T-shirt / top',     category: 'top',    words: ['tshirt', 'tee', 'top', 'tank', 'vest', 'camisole'] },
    { art: 'shirt',  label: 'Shirt',             category: 'top',    words: ['shirt', 'blouse', 'oxford', 'polo'] },
  ];
  const STORES = { zara: 'Zara', nike: 'Nike', hollisterco: 'Hollister', hollister: 'Hollister', hm: 'H&M', uniqlo: 'Uniqlo',
    gap: 'Gap', adidas: 'Adidas', asos: 'ASOS', mango: 'Mango', cos: 'COS', levi: "Levi's", abercrombie: 'Abercrombie & Fitch',
    shein: 'SHEIN', aritzia: 'Aritzia', lululemon: 'lululemon', amazon: 'Amazon', taobao: 'Taobao', tmall: 'Tmall', jd: 'JD' };
  const COLORS = { black: '#232323', white: '#ecebe7', ecru: '#e6dccb', cream: '#e9dfcc', beige: '#cdb793', sand: '#cdb793', camel: '#b98c55',
    brown: '#6b4a33', navy: '#233152', blue: '#3a5a86', denim: '#3a5a86', grey: '#8a8d93', gray: '#8a8d93', charcoal: '#44464c',
    green: '#4a6b4a', khaki: '#8b8559', olive: '#6b6b3a', red: '#b5462f', burgundy: '#6e2433', pink: '#e2a3b0', yellow: '#e3c04d', orange: '#d9793a', purple: '#6b4f8a' };

  function titleCase(w) { return w.charAt(0).toUpperCase() + w.slice(1); }

  /** Best guess at store, name, type and colour from a product URL. Returns null if it isn't a web link. */
  function parseProductLink(raw) {
    let u;
    try { u = new URL(String(raw).trim()); } catch (e) { return null; }
    if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) return null;
    const hostParts = u.hostname.replace(/^www\./, '').split('.');
    const storeKey = Object.keys(STORES).find(k => hostParts.some(p => p === k || p.startsWith(k)));
    const store = storeKey ? STORES[storeKey] : titleCase(hostParts.length > 2 ? hostParts[hostParts.length - 2] : hostParts[0]);

    // Longest readable path segment is usually the product slug.
    const segs = decodeURIComponent(u.pathname).split('/').map(x => x.replace(/\.(html?|aspx?|php)$/i, '')).filter(Boolean);
    const slug = segs.filter(x => /[a-z]{3}/i.test(x)).sort((a, b) => b.length - a.length)[0] || '';
    const GENERIC = /^(p|t|dp|en|us|ca|uk|shop|store|item|items|detail|details|product|products|productpage|goods|html)$/;
    const words = slug.toLowerCase().replace(/\bt[-_ ]?shirts?\b/g, 'tshirt').split(/[-_+.\s]+/)
      .filter(w => w && !/\d/.test(w) && !GENERIC.test(w));
    const text = ' ' + words.join(' ') + ' ' + u.search.toLowerCase() + ' ';
    const type = TYPES.find(t => t.words.some(w => text.includes(' ' + w))) || TYPES.find(t => t.art === 'tee');
    const colorWord = Object.keys(COLORS).find(c => new RegExp('[^a-z]' + c + '[^a-z]').test(text));
    const name = words.length ? words.slice(0, 7).map(w => (w === 'tshirt' ? 'T-Shirt' : titleCase(w))).join(' ') : `${store} item`;
    return { url: u.href, store, name, art: type.art, color: colorWord ? COLORS[colorWord] : null };
  }

  function makeCustomGarment({ url, store, name, art, color }) {
    const type = TYPES.find(t => t.art === art) || TYPES.find(t => t.art === 'tee');
    const base = GARMENTS.find(g => g.art === type.art);
    let h = 0;
    for (const ch of url + art) h = (h * 31 + ch.charCodeAt(0)) | 0;
    return {
      id: 'link-' + (h >>> 0).toString(36), custom: true, url, name, brand: store, art: type.art, category: type.category,
      color: color || base.color, bg: '#ece6dc', price: 'Price on store site',
      fabric: `Standard ${type.label.toLowerCase()} size chart (estimate)`,
      rules: base.rules, sizes: base.sizes, addedAt: Date.now(),
    };
  }

  function loadCustom() {
    try { const list = JSON.parse(localStorage.getItem(CUSTOM_KEY)); return Array.isArray(list) ? list : []; } catch (e) { return []; }
  }
  function saveCustom(g) {
    const list = [g, ...loadCustom().filter(x => x.id !== g.id)].slice(0, 12);
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }
  function removeCustom(id) {
    try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(loadCustom().filter(x => x.id !== id))); } catch (e) { /* ignore */ }
  }
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
      chip: p.chip[code], phrase: dir ? `${p[code]} ${t.where}` : null, adj: dir ? p[code] : null, where: t.where,
      distance: Math.abs(ease - (g0 + g1) / 2) / Math.max(1, g1 - g0),
      goodMin: g0, goodMax: g1,
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
    const order = Object.keys(g.sizes);
    const recommended = Object.values(sizes).sort((a, b) => a.penalty - b.penalty)[0].size;
    return { recommended, sizes, order, notes: whyNotes(sizes, order, recommended) };
  }

  // "Why this size": what goes wrong one size down and one size up.
  function whyNotes(sizes, order, rec) {
    const notes = [];
    const i = order.indexOf(rec);
    const issues = (s, dir) => sizes[s].regions.filter(r => r.level !== 'good' && (dir < 0 ? r.ease < r.goodMin : r.ease > r.goodMax)); 
    if (i > 0) {
      const down = order[i - 1], list = issues(down, -1);
      notes.push(list.length ? `${down} would be ${phraseList(list)}.` : `${down} also fits, but ${rec} is more comfortable overall.`);
    }
    if (i < order.length - 1) {
      const up = order[i + 1], list = issues(up, 1);
      notes.push(list.length ? `${up} would be ${phraseList(list)}.` : `${up} also fits if you like a roomier feel.`);
    }
    return notes;
  }

  // "a little relaxed at the chest and at the waist" instead of repeating the adjective.
  function phraseList(regions) {
    const groups = new Map();
    for (const r of regions) groups.set(r.adj, [...(groups.get(r.adj) || []), r.where]);
    return joinList([...groups].map(([adj, wheres]) => `${adj} ${joinList(wheres)}`));
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
    const issueText = phraseList(issues);
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
    FIELDS, DEMO_BODY, SIZE_NAMES, GARMENTS, CM_PER_IN: 2.54,
    bodyFigure, setFigureValue, garmentArt, getGarment, fitReport, saveBody, loadBody,
    TYPES, parseProductLink, makeCustomGarment, loadCustom, saveCustom, removeCustom, esc,
  };
})();
