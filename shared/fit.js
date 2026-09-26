// Fit engine — the accurate part of the app.
// Pure functions, no dependencies. Used by the server (Node) and the browser (ES module).
//
// Body measurements come from Bodygram (names like bustGirth, waistGirth, ...), in cm.
// Garment size charts come from data/garments/*.json (see PLAN.md for the format).
//
// Every region comparison produces an "ease": garment measurement minus body measurement,
// in cm. Positive = room to spare, negative = garment smaller than the body.
// Girths are compared as full circumferences; flat widths from the chart are doubled first.

export const VERDICTS = ['tight', 'snug', 'good', 'loose', 'very_loose'];

export const VERDICT_LABEL = {
  tight: 'Tight',
  snug: 'Snug',
  good: 'Good',
  loose: 'Relaxed',
  very_loose: 'Very loose',
};

export const VERDICT_COLOR = {
  tight: '#e5484d',
  snug: '#f5b301',
  good: '#30a46c',
  loose: '#3e8fe0',
  very_loose: '#1f5fb0',
};

// Extra negative ease a fabric can absorb before it feels tight (cm of circumference).
const STRETCH_ALLOWANCE = { none: 0, low: 0, medium: 3, high: 6 };

// Ease bands per region, in cm: [tight below, snug below, good below, loose below, else very_loose].
// Girth regions are circumference ease; shoulder/length regions are linear.
const BANDS = {
  chest: [0, 6, 16, 28],
  waist_top: [0, 6, 16, 28],
  hem: [0, 4, 14, 26],
  shoulder: [-2, 0, 3, 7],
  waist: [-1, 2, 6, 12],
  hip: [0, 3, 9, 16],
  thigh: [0, 2, 7, 13],
};

// Which region maps to which Bodygram measurement, how to convert the chart value,
// and where it sits on the body (used by the 3D viewer). heightKey = Bodygram height measurement.
export const REGION_DEFS = {
  top: {
    chest: { chartKey: 'chest', bodyKey: 'bustGirth', kind: 'girth', heightKey: 'bustHeight', label: 'Chest' },
    waist_top: { chartKey: 'waist', bodyKey: 'waistGirth', kind: 'girth', heightKey: 'waistHeight', label: 'Waist' },
    hem: { chartKey: 'hem', bodyKey: null, kind: 'girth_at_hem', label: 'Hem' },
    shoulder: { chartKey: 'shoulder', bodyKey: 'acrossBackShoulderWidth', kind: 'linear', label: 'Shoulders' },
    length: { chartKey: 'length', kind: 'top_length', label: 'Length' },
    sleeve: { chartKey: 'sleeve', kind: 'sleeve', label: 'Sleeves' },
  },
  bottom: {
    waist: { chartKey: 'waist', bodyKey: 'waistGirth', kind: 'girth', heightKey: 'waistHeight', label: 'Waist' },
    hip: { chartKey: 'hip', bodyKey: 'hipGirth', kind: 'girth', heightKey: 'hipHeight', label: 'Hips' },
    thigh: { chartKey: 'thigh', bodyKey: 'thighGirthR', kind: 'girth', heightKey: null, label: 'Thighs' },
    inseam: { chartKey: 'inseam', kind: 'inseam', label: 'Inseam' },
  },
};

function bandVerdict(ease, bands, stretchShift = 0) {
  const [t, s, g, l] = bands;
  if (ease < t - stretchShift) return 'tight';
  if (ease < s) return 'snug';
  if (ease < g) return 'good';
  if (ease < l) return 'loose';
  return 'very_loose';
}

/** Chart value -> full circumference in cm. */
function chartGirth(value, garment) {
  return garment.chart_type === 'garment_flat' ? value * 2 : value;
}

/** Height (cm from ground) of common landmarks, derived from the scan. */
export function bodyLandmarks(body) {
  const neck = body.backNeckHeight;
  const waist = body.waistHeight;
  const topHip = body.topHipHeight ?? (body.waistHeight + body.hipHeight) / 2;
  const hip = body.hipHeight;
  const knee = body.kneeHeightR;
  const crotch = body.insideLegHeight;
  const midThigh = crotch != null && knee != null ? (crotch + knee) / 2 : hip - 20;
  return { neck, waist, topHip, hip, crotch, midThigh, knee, ankle: body.outerAnkleHeightR ?? 7 };
}

/** Where a top's hem lands, given garment length from back neck. */
function topLengthVerdict(lengthCm, body) {
  const lm = bodyLandmarks(body);
  const hemY = lm.neck - lengthCm;
  // Regions from highest to lowest. A regular top ends between the top of the hip and the crotch.
  const zones = [
    { below: lm.waist + 3, where: 'above the waist (cropped)', verdict: 'snug' },
    { below: lm.topHip - 1, where: 'at the waist', verdict: 'snug' },
    { below: lm.crotch - 6, where: 'at the hip', verdict: 'good' },
    { below: lm.midThigh, where: 'below the hip', verdict: 'loose' },
  ];
  for (const z of zones) if (hemY > z.below) return { hemY, lands_at: z.where, verdict: z.verdict };
  return { hemY, lands_at: 'mid-thigh or lower', verdict: 'very_loose' };
}

function sleeveVerdict(sleeveCm, sleeveType, body) {
  if (sleeveType === 'long') {
    const arm = body.outerArmLengthR; // shoulder to wrist
    const ease = sleeveCm - arm;
    let verdict = 'good';
    let lands_at = 'at the wrist';
    if (ease < -5) [verdict, lands_at] = ['tight', 'well above the wrist'];
    else if (ease < -2) [verdict, lands_at] = ['snug', 'just above the wrist'];
    else if (ease > 6) [verdict, lands_at] = ['very_loose', 'over the hand'];
    else if (ease > 2.5) [verdict, lands_at] = ['loose', 'past the wrist'];
    return { ease_cm: round(ease), lands_at, verdict };
  }
  // Short sleeve: compare against shoulder->elbow length.
  const upper = body.shoulderToElbowR;
  const frac = sleeveCm / upper;
  if (frac < 0.5) return { ease_cm: null, lands_at: 'high on the upper arm', verdict: 'snug' };
  if (frac < 0.8) return { ease_cm: null, lands_at: 'mid upper arm', verdict: 'good' };
  if (frac < 1.0) return { ease_cm: null, lands_at: 'just above the elbow', verdict: 'loose' };
  return { ease_cm: null, lands_at: 'past the elbow', verdict: 'very_loose' };
}

const round = (x) => (x == null ? null : Math.round(x * 10) / 10);

/**
 * Evaluate ONE size of a garment against the body.
 * @param body  {name: cm} Bodygram measurements
 * @param garment garment JSON
 * @param size  size key, e.g. "M"
 */
export function evaluateSize(body, garment, size) {
  const chart = garment.sizes[size];
  if (!chart) throw new Error(`Unknown size ${size}`);
  const defs = REGION_DEFS[garment.category];
  if (!defs) throw new Error(`Unknown category ${garment.category}`);
  const stretchShift = STRETCH_ALLOWANCE[garment.stretch ?? 'low'] ?? 0;
  const regions = {};

  for (const [region, def] of Object.entries(defs)) {
    const v = chart[def.chartKey];
    if (v == null) continue;

    if (def.kind === 'girth') {
      const bodyV = body[def.bodyKey];
      if (bodyV == null) continue;
      const garmentV = chartGirth(v, garment);
      const ease = garmentV - bodyV;
      regions[region] = {
        label: def.label,
        garment_cm: round(garmentV),
        body_cm: round(bodyV),
        ease_cm: round(ease),
        verdict: bandVerdict(ease, BANDS[region], stretchShift),
        height_cm: def.heightKey ? body[def.heightKey] : null,
      };
    } else if (def.kind === 'girth_at_hem') {
      // Hem width matters at whatever body height the hem lands on.
      const len = chart.length;
      if (len == null) continue;
      const { hemY } = topLengthVerdict(len, body);
      const bodyV = girthAtHeight(body, hemY);
      if (bodyV == null) continue;
      const garmentV = chartGirth(v, garment);
      const ease = garmentV - bodyV;
      regions[region] = {
        label: def.label,
        garment_cm: round(garmentV),
        body_cm: round(bodyV),
        ease_cm: round(ease),
        verdict: bandVerdict(ease, BANDS.hem, stretchShift),
        height_cm: round(hemY),
      };
    } else if (def.kind === 'linear') {
      const bodyV = body[def.bodyKey];
      if (bodyV == null) continue;
      const ease = v - bodyV;
      regions[region] = {
        label: def.label,
        garment_cm: round(v),
        body_cm: round(bodyV),
        ease_cm: round(ease),
        verdict: bandVerdict(ease, BANDS[region], 0),
        height_cm: body.backNeckHeight,
      };
    } else if (def.kind === 'top_length') {
      const r = topLengthVerdict(v, body);
      regions[region] = { label: def.label, garment_cm: v, lands_at: r.lands_at, verdict: r.verdict, height_cm: round(r.hemY) };
    } else if (def.kind === 'sleeve') {
      const r = sleeveVerdict(v, garment.sleeve_type ?? 'short', body);
      regions[region] = { label: def.label, garment_cm: v, ...r };
    } else if (def.kind === 'inseam') {
      const bodyV = body.insideLegHeight;
      if (bodyV == null) continue;
      const ease = v - bodyV;
      let verdict = 'good';
      let lands_at = 'at the ankle';
      if (ease < -6) [verdict, lands_at] = ['tight', 'above the ankle'];
      else if (ease < -2.5) [verdict, lands_at] = ['snug', 'just above the ankle'];
      else if (ease > 8) [verdict, lands_at] = ['very_loose', 'bunching on the shoe'];
      else if (ease > 3) [verdict, lands_at] = ['loose', 'over the shoe'];
      regions[region] = { label: def.label, garment_cm: v, body_cm: round(bodyV), ease_cm: round(ease), lands_at, verdict };
    }
  }

  return { size, regions, score: scoreRegions(regions), summary: summarize(regions, garment) };
}

/** Body circumference at a given height, interpolated between known girths. */
export function girthAtHeight(body, y) {
  const pts = [
    [body.bustHeight, body.bustGirth],
    [body.waistHeight, body.waistGirth],
    [body.bellyWaistHeight, body.bellyWaistGirth],
    [body.topHipHeight, body.topHipGirth],
    [body.hipHeight, body.hipGirth],
  ]
    .filter(([h, g]) => h != null && g != null)
    .sort((a, b) => b[0] - a[0]); // top to bottom
  if (!pts.length) return null;
  if (y >= pts[0][0]) return pts[0][1];
  if (y <= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i++) {
    const [h1, g1] = pts[i];
    const [h2, g2] = pts[i + 1];
    if (y <= h1 && y >= h2) {
      const t = (h1 - y) / (h1 - h2 || 1);
      return g1 + (g2 - g1) * t;
    }
  }
  return null;
}

// Lower is better. Tight is the worst outcome (you can't wear it); very loose next.
const PENALTY = { tight: 4, very_loose: 2, loose: 0.75, snug: 0.5, good: 0 };
function scoreRegions(regions) {
  let s = 0;
  for (const r of Object.values(regions)) s += PENALTY[r.verdict] ?? 1;
  return s;
}

function joinList(items) {
  if (items.length <= 1) return items.join('');
  return items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
}

function summarize(regions, garment) {
  const by = {};
  for (const [key, r] of Object.entries(regions)) {
    if (key === 'length' || key === 'sleeve' || key === 'inseam') continue;
    (by[r.verdict] ??= []).push(r.label.toLowerCase());
  }
  const parts = [];
  if (by.tight) parts.push(`Tight ${joinList(by.tight)}`);
  if (by.snug) parts.push(`snug ${joinList(by.snug)}`);
  if (by.good) parts.push(`good through the ${joinList(by.good)}`);
  if (by.loose) parts.push(`relaxed ${joinList(by.loose)}`);
  if (by.very_loose) parts.push(`very loose ${joinList(by.very_loose)}`);
  let text = parts.length ? parts.join('; ') + '.' : '';
  text = text.charAt(0).toUpperCase() + text.slice(1);
  if (regions.length) text += ` Hem lands ${regions.length.lands_at}.`;
  if (regions.sleeve) text += ` Sleeves end ${regions.sleeve.lands_at}.`;
  if (regions.inseam) text += ` Leg ends ${regions.inseam.lands_at}.`;
  return text.trim();
}

/**
 * Full fit report: every size evaluated + recommendation.
 * @returns {{ recommended: string, sizes: Object, garment_id: string }}
 */
export function fitReport(body, garment) {
  const sizes = {};
  for (const size of Object.keys(garment.sizes)) sizes[size] = evaluateSize(body, garment, size);

  const order = Object.keys(garment.sizes);
  let best = null;
  for (const size of order) {
    const s = sizes[size];
    // Prefer lowest penalty; on a tie prefer the smaller size (charts list small -> large).
    if (!best || s.score < best.score) best = s;
  }
  const recommended = best.size;

  const notes = [];
  const idx = order.indexOf(recommended);
  const tightRegions = Object.values(sizes[recommended].regions).filter((r) => r.verdict === 'tight');
  if (tightRegions.length && idx < order.length - 1) notes.push(`Still tight ${joinList(tightRegions.map((r) => r.label.toLowerCase()))} — consider going up to ${order[idx + 1]}.`);
  if (idx > 0) {
    const smaller = sizes[order[idx - 1]];
    const why = Object.values(smaller.regions).filter((r) => r.verdict === 'tight').map((r) => r.label.toLowerCase());
    if (why.length) notes.push(`${order[idx - 1]} would be tight ${joinList(why)}.`);
  }
  if (idx < order.length - 1) {
    const larger = sizes[order[idx + 1]];
    const why = Object.values(larger.regions).filter((r) => r.verdict === 'very_loose' || r.verdict === 'loose').map((r) => r.label.toLowerCase());
    if (why.length) notes.push(`${order[idx + 1]} would be looser ${joinList(why)}.`);
  }

  return { garment_id: garment.id, recommended, sizes, notes, size_order: order };
}
