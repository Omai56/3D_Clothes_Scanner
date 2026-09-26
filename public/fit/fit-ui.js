/* Shared UI logic for the 3-page flow at /fit/.
 * Real data: garments from /api/garments, saved bodies from /api/scans, fit results from
 * /api/fit (the team's engine in shared/fit.js). This file only draws and words the result.
 */
(function () {
  const STORE_KEY = 'fit.body.v2';

  const FIELDS = [
    { key: 'height',   bodyKey: null,                      label: 'Height',         hint: 'Standing straight, no shoes',                min: 120, max: 230 },
    { key: 'chest',    bodyKey: 'bustGirth',               label: 'Chest',          hint: 'Around the fullest part of your chest',      min: 60,  max: 160 },
    { key: 'waist',    bodyKey: 'waistGirth',              label: 'Waist',          hint: 'Around your natural waist, above the navel', min: 50,  max: 160 },
    { key: 'hip',      bodyKey: 'hipGirth',                label: 'Hips',           hint: 'Around the widest part of your hips',        min: 60,  max: 170 },
    { key: 'inseam',   bodyKey: 'insideLegHeight',         label: 'Inseam',         hint: 'Crotch to the floor, inside of the leg',     min: 50,  max: 110 },
    { key: 'shoulder', bodyKey: 'acrossBackShoulderWidth', label: 'Shoulder width', hint: 'Across your back, shoulder tip to tip',      min: 30,  max: 65 },
  ];

  const SIZE_NAMES = { XXS: 'Extra Extra Small', XS: 'Extra Small', S: 'Small', M: 'Medium', L: 'Large', XL: 'Extra Large', XXL: 'XXL' };
  const sizeName = s => SIZE_NAMES[s] || (/^\d+$/.test(s) ? `${s}` : s);

  // ---------- API ----------
  async function api(path, opts) {
    const r = await fetch(path, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  }
  const getScans = () => api('/api/scans');
  const getScan = name => api('/api/scans/' + encodeURIComponent(name));
  const getGarments = () => api('/api/garments');
  const getGarment = id => api('/api/garments/' + encodeURIComponent(id));

  /** Six typed numbers -> a full Bodygram-style body, by scaling the saved demo scan.
   *  The fit engine also needs heights, arm and thigh girths; we estimate those from the
   *  closest typed measurement. The six typed values are used exactly. */
  function estimateBody(values, template) {
    const t = template.measurements_cm;
    const tHeight = template.input?.heightCm || 175;
    const k = { len: values.height / tHeight, chest: values.chest / t.bustGirth, waist: values.waist / t.waistGirth, hip: values.hip / t.hipGirth };
    const scale = {
      len: ['backNeckHeight', 'backNeckPointToGroundContoured', 'backNeckPointToWaist', 'backNeckPointToWristLengthR', 'bellyWaistHeight',
            'bustHeight', 'hipHeight', 'insideLegLengthR', 'kneeHeightR', 'outerAnkleHeightR', 'outerArmLengthR', 'outseamR',
            'outsideLegLengthR', 'shoulderToElbowR', 'topHipHeight', 'waistHeight'],
      chest: ['underBustGirth', 'upperArmGirthR', 'forearmGirthR', 'wristGirthR', 'neckGirth', 'neckBaseGirth'],
      waist: ['bellyWaistGirth', 'bellyWaistDepth', 'bellyWaistWidth', 'topHipGirth'],
      hip: ['thighGirthR', 'midThighGirthR', 'kneeGirthR', 'calfGirthR'],
    };
    const body = { ...t };
    for (const [g, keys] of Object.entries(scale)) for (const key of keys) if (t[key] != null) body[key] = +(t[key] * k[g]).toFixed(1);
    for (const f of FIELDS) if (f.bodyKey) body[f.bodyKey] = values[f.key];
    return body;
  }

  function valuesFromScan(scan) {
    const m = scan.measurements_cm;
    const v = { height: scan.input?.heightCm ?? Math.round(m.backNeckHeight / 0.85) };
    for (const f of FIELDS) if (f.bodyKey) v[f.key] = m[f.bodyKey];
    return v;
  }

  // ---------- Storage (per-viewer convenience) ----------
  // { source: 'scan', scan: 'daniel', label, values } or { source: 'manual', values }
  function saveBody(b) { try { localStorage.setItem(STORE_KEY, JSON.stringify(b)); } catch (e) { /* ignore */ } }
  function loadBody() {
    try {
      const b = JSON.parse(localStorage.getItem(STORE_KEY));
      if (b && b.values && FIELDS.every(f => typeof b.values[f.key] === 'number')) return b;
    } catch (e) { /* ignore */ }
    return null;
  }

  /** Ask the team's fit engine. Saved scans go by name; typed numbers go as an estimated full body. */
  async function runFit(saved, garmentId) {
    let payload;
    if (saved && saved.source === 'scan') payload = { scan: saved.scan, garment_id: garmentId };
    else {
      const template = await getScan('demo');
      payload = { measurements_cm: estimateBody(saved ? saved.values : valuesFromScan(template), template), garment_id: garmentId };
    }
    return api('/api/fit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  }

  // ---------- Body silhouette ----------
  const BODY_PATH =
    'M90 60 L90 74 C78 78 60 78 52 86 C44 92 42 104 41 118 L36 180 L32 238 ' +
    'C30 250 34 260 40 258 C44 256 46 248 46 240 L52 184 L58 132 ' +
    'C60 150 66 162 70 172 C66 190 62 204 62 216 L68 330 L74 410 L68 422 L94 422 L94 410 ' +
    'L96 330 L100 246 L104 330 L106 410 L106 422 L132 422 L126 410 L132 330 L138 216 ' +
    'C138 204 134 190 130 172 C134 162 140 150 142 132 L148 184 L154 240 ' +
    'C154 248 156 256 160 258 C166 260 170 250 168 238 L164 180 L159 118 ' +
    'C158 104 156 92 148 86 C140 78 122 78 110 74 L110 60 Z';

  // Each area: bands clipped to the silhouette, plus the tape-measure line shown on page 1.
  const AREAS = {
    height:   { rects: [[0, 0, 200, 440]],                 line: 'M184 14 L184 422', caps: 'M178 14 L190 14 M178 422 L190 422' },
    shoulder: { rects: [[38, 74, 124, 26]],                line: 'M52 86 L148 86' },
    arm:      { rects: [[28, 100, 29, 60], [143, 100, 29, 60]] },
    chest:    { rects: [[57, 100, 86, 46]],                line: 'M58 120 L142 120' },
    waist:    { rects: [[58, 146, 84, 44]],                line: 'M68 172 L132 172' },
    hip:      { rects: [[58, 190, 84, 54]],                line: 'M62 218 L138 218' },
    thigh:    { rects: [[62, 244, 76, 86]] },
    inseam:   { rects: [[62, 330, 76, 94]],                line: 'M100 250 L100 420', caps: 'M94 250 L106 250 M94 420 L106 420' },
  };

  let figureCount = 0;
  function bodyFigure(label) {
    const id = 'bodyclip' + (++figureCount);
    const areas = Object.entries(AREAS).map(([key, a]) =>
      `<g class="region" data-region="${key}">${a.rects.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join('')}</g>`).join('');
    const lines = Object.entries(AREAS).filter(([, a]) => a.line).map(([key, a]) =>
      `<path class="measure" data-region="${key}" d="${a.line}"/>` + (a.caps ? `<path class="measure cap" data-region="${key}" d="${a.caps}"/>` : '')).join('');
    return `
<svg class="body-figure" viewBox="0 0 200 440" role="img" aria-label="${label || 'Body outline'}">
  <defs><clipPath id="${id}"><path d="${BODY_PATH}"/><ellipse cx="100" cy="36" rx="21" ry="25"/></clipPath></defs>
  <ellipse class="silhouette" cx="100" cy="36" rx="21" ry="25"/>
  <path class="silhouette" d="${BODY_PATH}"/>
  <g clip-path="url(#${id})">${areas}</g>
  ${lines}
</svg>`;
  }

  // ---------- Turning the engine's verdicts into colours and words ----------
  // Engine verdicts: tight / snug / good / loose (relaxed) / very_loose.
  const LEVEL = { good: 'good', snug: 'warn', loose: 'warn', tight: 'bad', very_loose: 'bad' };
  const RANK = { good: 0, warn: 1, bad: 2 };

  // Engine region -> figure area, plain-English noun and where-phrase.
  const REGION_INFO = {
    chest:     { area: 'chest',    noun: 'chest',       where: 'at the chest',          kind: 'girth' },
    waist_top: { area: 'waist',    noun: 'waist',       where: 'at the waist',          kind: 'girth' },
    waist:     { area: 'waist',    noun: 'waist',       where: 'at the waist',          kind: 'girth' },
    hem:       { area: 'hip',      noun: 'hem',         where: 'at the hem',            kind: 'girth' },
    hip:       { area: 'hip',      noun: 'hips',        where: 'through the hips',      kind: 'girth' },
    thigh:     { area: 'thigh',    noun: 'thighs',      where: 'through the thighs',    kind: 'girth' },
    arm:       { area: 'arm',      noun: 'upper arms',  where: 'around the upper arms', kind: 'girth' },
    shoulder:  { area: 'shoulder', noun: 'shoulders',   where: 'in the shoulders',      kind: 'width' },
    length:    { area: null,       noun: 'length',      where: 'in the body length',    kind: 'length' },
    sleeve:    { area: 'arm',      noun: 'sleeves',     where: 'in the sleeves',        kind: 'length', weak: true },
    inseam:    { area: 'inseam',   noun: 'leg length',  where: 'in the leg',            kind: 'length' },
  };

  const ADJ = {
    girth:  { snug: 'slightly snug', tight: 'tight', loose: 'a little relaxed', very_loose: 'very loose' },
    width:  { snug: 'slightly narrow', tight: 'too narrow', loose: 'slightly wide', very_loose: 'too wide' },
    length: { snug: 'a little short', tight: 'too short', loose: 'a little long', very_loose: 'too long' },
  };
  const CHIP = {
    girth:  { good: 'Good fit', snug: 'Snug', tight: 'Too tight', loose: 'Relaxed', very_loose: 'Too loose' },
    width:  { good: 'Good fit', snug: 'Narrow', tight: 'Too narrow', loose: 'Wide', very_loose: 'Too wide' },
    length: { good: 'Good length', snug: 'A bit short', tight: 'Too short', loose: 'A bit long', very_loose: 'Too long' },
  };

  function describeSize(sizeResult) {
    const regions = Object.entries(sizeResult.regions).map(([key, r]) => {
      const info = REGION_INFO[key] || { area: null, noun: r.label.toLowerCase(), where: `at the ${r.label.toLowerCase()}`, kind: 'girth' };
      const detail = r.lands_at ? `Ends ${r.lands_at}` : r.ease_cm != null ? `${r.ease_cm > 0 ? '+' : ''}${r.ease_cm} cm room` : '';
      return { key, ...info, label: r.label, verdict: r.verdict, level: LEVEL[r.verdict] || 'warn',
               chip: CHIP[info.kind][r.verdict] || r.verdict, detail, note: r.note || null };
    });

    // Colour per figure area = the worst verdict mapped to it (sleeve only if the chart has no arm width).
    const areas = {};
    const hasArm = regions.some(r => r.key === 'arm');
    for (const r of regions) {
      if (!r.area || (r.weak && hasArm)) continue;
      if (!areas[r.area] || RANK[r.level] > RANK[areas[r.area]]) areas[r.area] = r.level;
    }
    return { regions, areas, summary: summarize(sizeResult.size, regions) };
  }

  function joinList(items) {
    if (items.length <= 1) return items.join('');
    return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
  }

  function summarize(size, regions) {
    const name = /^\d+$/.test(size) ? `Size ${size}` : sizeName(size);
    const good = regions.filter(r => r.level === 'good').map(r => r.noun);
    const issues = regions.filter(r => r.level !== 'good');
    if (!issues.length) return `${name} is a great match, fitting well through the ${joinList(good)}.`;
    // Group places that share a wording: "a little relaxed at the chest and around the upper arms".
    const groups = new Map();
    for (const r of issues) {
      const adj = ADJ[r.kind][r.verdict];
      groups.set(adj, [...(groups.get(adj) || []), r.where]);
    }
    const issueText = joinList([...groups].map(([adj, wheres]) => `${adj} ${joinList(wheres)}`));
    if (!good.length) return `${name} is the closest size, but it is ${issueText}.`;
    const hasBad = issues.some(r => r.level === 'bad');
    return `${name} fits well through the ${joinList(good)}, ${hasBad ? 'but is' : 'and is'} ${issueText}.`;
  }

  const isSampleChart = g => /demo data/i.test(g.source || '');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  window.Fit = {
    FIELDS, sizeName, getScans, getScan, getGarments, getGarment, runFit, valuesFromScan,
    saveBody, loadBody, bodyFigure, describeSize, isSampleChart, esc,
  };
})();
