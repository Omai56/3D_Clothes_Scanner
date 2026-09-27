// Pure mapping from Zara's JSON (size-measure-guide, viewPayload product) to our garment format.
// No network here so it can be unit-tested with fixtures.

// Zara table titles (English, incl. their machine-translated ones) -> our chart keys.
const LABELS = [
  [/^chest$|bust/i, 'chest'],
  [/^waist$/i, 'waist'],
  [/^hip$|hips/i, 'hip'],
  [/front length|^length$|body length/i, 'length'],
  [/total length|outseam|outer leg/i, 'total_length'],
  [/sleeve length|^sleeve$/i, 'sleeve'],
  [/wide back|back width|shoulder/i, 'shoulder'],
  [/arm width|bicep|upper arm/i, 'arm_width'],
  [/front rise|front tow hook|^rise$/i, 'rise'],
  [/back rise|backfire/i, 'back_rise'],
  [/thigh/i, 'thigh'],
  [/inseam|inside leg|inner leg/i, 'inseam'],
  [/leg opening|hem width|^hem$|bottom width/i, 'leg_opening'],
];

export function mapLabel(title) {
  const t = String(title || '').trim();
  for (const [re, key] of LABELS) if (re.test(t)) return key;
  return null;
}

/** size-measure-guide JSON -> { sizes: {S: {chest: 56, ...}}, unmapped: [...] } (cm). */
export function mapZaraChart(guide) {
  const info = guide?.measureGuideInfo;
  if (!info?.sizes?.length) return null;
  const sizes = {};
  const unmapped = new Set();
  for (const sz of info.sizes) {
    const row = {};
    for (const m of sz.measures ?? []) {
      const key = mapLabel(m.tableTitle);
      const cm = m.dimensions?.find((d) => d.unitId === 'cm')?.value;
      if (!key) {
        unmapped.add(m.tableTitle);
        continue;
      }
      if (cm != null && cm !== '') row[key] = Number(cm);
    }
    if (Object.keys(row).length) sizes[sz.name] = row;
  }
  // Tops call the hem width "hem"; bottoms call it leg opening. Rename for tops.
  const isBottom = looksLikeBottom(sizes);
  if (!isBottom) for (const r of Object.values(sizes)) if (r.leg_opening != null) { r.hem = r.leg_opening; delete r.leg_opening; }
  return { sizes, unmapped: [...unmapped], category: isBottom ? 'bottom' : 'top' };
}

export function looksLikeBottom(sizes) {
  const first = Object.values(sizes)[0] ?? {};
  return first.rise != null || first.inseam != null || first.total_length != null || first.thigh != null || (first.waist != null && first.chest == null);
}

/** detailedComposition ({parts:[{description, components:[{material, percentage}]}]}) -> "95% cotton, 5% elastane" */
export function compositionText(dc) {
  const parts = dc?.parts ?? [];
  const outer = parts.find((p) => /outer|shell|main/i.test(p.description)) ?? parts[0];
  if (!outer?.components?.length) return null;
  return outer.components.map((c) => `${c.percentage} ${c.material}`.trim()).join(', ');
}

/** Stretch level from the composition string. */
export function stretchFromComposition(text, { denim = false } = {}) {
  const m = /(\d+)%\s*(elastane|spandex|lycra|elastomultiester|elasterell)/i.exec(text ?? '');
  const pct = m ? Number(m[1]) : 0;
  if (pct >= 5) return 'high';
  if (pct >= 2) return 'medium';
  if (pct > 0) return 'low';
  if (denim && /100%\s*cotton/i.test(text ?? '')) return 'none';
  return 'low';
}

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

/**
 * Build our garment JSON from the pieces the importer gathered.
 * @param p { url, productId, name, brand, reference, price, currency, color, description,
 *            familyName, subfamilyName, sectionName, composition, images, chart }
 */
export function buildGarment(p) {
  const chart = p.chart;
  const family = `${p.familyName ?? ''} ${p.subfamilyName ?? ''} ${p.name ?? ''}`;
  const denim = /jean|denim/i.test(family);
  const category = /trouser|jean|pant|short|skirt|jogger|chino/i.test(family) ? 'bottom' : chart?.category ?? 'top';
  const first = Object.values(chart?.sizes ?? {})[0] ?? {};
  const sleeveType = first.sleeve == null ? 'none' : first.sleeve >= 40 ? 'long' : 'short';
  const id = `zara-${slugify(p.name)}-${p.productId}`;
  return {
    id,
    name: titleCase(p.name),
    brand: p.brand ?? 'Zara',
    url: p.url,
    ref: p.reference ?? null,
    price: p.price != null ? `${p.currency ?? ''}${(p.price / 100).toFixed(2)}`.trim() : null,
    color: p.color ?? null,
    category,
    ...(category === 'top' ? { sleeve_type: sleeveType } : {}),
    fabric: p.composition ?? null,
    stretch: stretchFromComposition(p.composition, { denim }),
    description: p.description ?? null,
    images: p.images ?? [],
    source: `Imported from zara.com on ${new Date().toISOString().slice(0, 10)} (PRODUCT MEASUREMENTS, garment measured flat, cm)`,
    chart_type: 'garment_flat',
    units: 'cm',
    measurements_note:
      'chest / waist / hip / arm_width / hem = width measured flat (half circumference); length = front length; shoulder = "wide back" seam to seam; sleeve = shoulder seam to cuff; total_length = outseam; rise = front rise',
    sizes: chart?.sizes ?? {},
    unmapped_measurements: chart?.unmapped?.length ? chart.unmapped : undefined,
  };
}

function titleCase(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/(^|\s|\/)([a-z])/g, (m, a, b) => a + b.toUpperCase())
    .replace(/\bT-shirt\b/g, 'T-Shirt');
}
