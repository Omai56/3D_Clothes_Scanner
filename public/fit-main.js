// Items imported from a real product page (Zara, via /api/import) carry the store's own size chart
// (`chart`, the team's garment format). They are judged by the team's fit engine (shared/fit.js),
// which understands boxy cuts, dropped shoulders and trouser rise; FitCheck's own rules are
// tuned to its sample items. Importing this module switches Fit.fitReport over for those items.
import { fitReport as mainFitReport, VERDICT_LABEL } from '/shared/fit.js';

// Demo scan (data/scans/demo.json). FitCheck's DEMO_BODY is this body's key measurements.
const DEMO_SCAN = {
  waistHeight: 105.1, topHipHeight: 95.6, hipHeight: 86.2, insideLegHeight: 79.7, backNeckHeight: 148.4,
  bustHeight: 125.4, bellyWaistHeight: 102.1, kneeHeightR: 48.1, outerAnkleHeightR: 6.5,
  shoulderToElbowR: 32.2, outerArmLengthR: 59.4,
  bustGirth: 91.4, waistGirth: 77.9, bellyWaistGirth: 79.4, topHipGirth: 84.1, hipGirth: 93.5,
  thighGirthR: 56.2, upperArmGirthR: 28.5, neckGirth: 37.8, acrossBackShoulderWidth: 46.7,
};
const DEMO_HEIGHT = 175;
const LENGTHS = ['waistHeight', 'topHipHeight', 'hipHeight', 'backNeckHeight', 'bustHeight', 'bellyWaistHeight',
  'kneeHeightR', 'outerAnkleHeightR', 'shoulderToElbowR', 'outerArmLengthR'];

/** Full body measurements from FitCheck's six: the demo scan, scaled to the person's height and girths. */
export function toMainBody(b) {
  const d = DEMO_SCAN;
  const out = { ...d };
  const v = (b.height || DEMO_HEIGHT) / DEMO_HEIGHT;
  for (const k of LENGTHS) out[k] = d[k] * v;
  Object.assign(out, {
    bustGirth: b.chest,
    waistGirth: b.waist,
    hipGirth: b.hip,
    insideLegHeight: b.inseam,
    acrossBackShoulderWidth: b.shoulder,
    bellyWaistGirth: d.bellyWaistGirth * (b.waist / d.waistGirth),
    topHipGirth: d.topHipGirth * ((b.waist + b.hip) / (d.waistGirth + d.hipGirth)),
    thighGirthR: d.thighGirthR * (b.hip / d.hipGirth),
    upperArmGirthR: d.upperArmGirthR * (b.chest / d.bustGirth),
    neckGirth: d.neckGirth * (b.chest / d.bustGirth),
  });
  return out;
}

// The team's verdicts on FitCheck's three-colour scale.
const LEVEL = { good: 'good', snug: 'warn', loose: 'warn', tight: 'bad', very_loose: 'bad' };

/** The team's fit report in the shape FitCheck's pages read. */
export function toFitCheckReport(r) {
  const sizes = {};
  for (const s of r.size_order) {
    const ev = r.sizes[s];
    const regions = Object.entries(ev.regions).map(([key, x]) => ({
      key,
      label: x.label,
      verdict: x.verdict,
      level: LEVEL[x.verdict] ?? 'warn',
      chip: VERDICT_LABEL[x.verdict] ?? x.verdict,
      ease: x.ease_cm ?? null,
      detail: x.ease_cm == null ? (x.lands_at ? `Ends ${x.lands_at}` : '') : null,
    }));
    const worst = regions.some((x) => x.level === 'bad') ? 'bad' : regions.some((x) => x.level === 'warn') ? 'warn' : 'good';
    sizes[s] = { size: s, regions, worst, summary: ev.summary };
  }
  return { recommended: r.recommended, sizes, order: r.size_order, notes: r.notes };
}

const ownFitReport = window.Fit.fitReport;
window.Fit.fitReport = (g, body) => (g.chart ? toFitCheckReport(mainFitReport(toMainBody(body), g.chart)) : ownFitReport(g, body));
window.Fit.SIZE_NAMES.XXS ??= 'Extra Extra Small';
window.Fit.SIZE_NAMES.XXL ??= 'Extra Extra Large';

// ---------- importing a product link ----------
const COLORS = {
  black: '#232323', white: '#ecebe7', ecru: '#e6dccb', cream: '#e9dfcc', beige: '#cdb793', sand: '#cdb793',
  camel: '#b98c55', brown: '#6b4a33', chocolate: '#5a3a26', grey: '#8d8f93', gray: '#8d8f93', navy: '#1f2a44',
  blue: '#3a5a86', indigo: '#2f3b5c', green: '#4f6b4a', khaki: '#8a8058', red: '#a3352c', pink: '#d99aa6',
  yellow: '#d9b84a', orange: '#d17a3a', purple: '#6a4c7d',
};

function artFor(g) {
  const name = `${g.name} ${g.familyName ?? ''} ${g.subfamilyName ?? ''}`.toLowerCase();
  if (g.category === 'bottom') return /jean|denim/.test(name) ? 'jeans' : 'chinos';
  if (/hoodie|sweatshirt/.test(name)) return 'hoodie';
  if (/jacket|coat|puffer|blazer|overshirt/.test(name)) return 'jacket';
  if (/shirt/.test(name.replace(/t-?shirt/g, ''))) return 'shirt';
  return 'tee';
}

/**
 * Read the product page behind a link (Zara only for now). Returns a FitCheck garment with the
 * store's real chart, or null when the store isn't supported. Throws if the page can't be read.
 */
export async function importLink(url) {
  let host;
  try { host = new URL(url).hostname; } catch { return null; }
  if (!/(^|\.)zara\.com$/i.test(host)) return null;
  const res = await fetch('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.imported) throw new Error(data.error || 'Could not read the product page');
  const g = data.garment;
  const colorKey = Object.keys(COLORS).find((c) => new RegExp(`\\b${c}\\b`, 'i').test(g.color ?? ''));
  return {
    id: g.id,
    custom: true,
    imported: true,
    url: g.url ?? url,
    name: g.name,
    brand: g.brand,
    art: artFor(g),
    category: g.category,
    color: colorKey ? COLORS[colorKey] : '#8d8f93',
    colorName: g.color,
    image: g.images?.[0] ?? null,
    bg: '#ece6dc',
    price: g.price ?? 'Price on store site',
    fabric: g.fabric ?? '',
    chart: g,
    sizes: g.sizes,
    addedAt: Date.now(),
  };
}
