// Live import of a Zara product: name, photos, composition and the full size chart.
//
// Zara's product page is behind bot protection for plain requests, but loads fine in a real
// browser from a normal (home) IP, so we drive the installed Chrome/Edge headlessly to read
// `window.zara.viewPayload`. The size chart and composition endpoints answer plain requests.
import fs from 'node:fs/promises';
import path from 'node:path';
import { mapZaraChart, compositionText, buildGarment } from './zara-map.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA ?? ''}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].filter(Boolean);

async function findBrowser() {
  for (const p of CHROME_CANDIDATES) {
    try {
      await fs.access(p);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

export function parseZaraUrl(url) {
  const u = new URL(url);
  if (!/(^|\.)zara\.com$/i.test(u.hostname)) throw new Error('Not a zara.com link');
  const [, country, lang] = u.pathname.split('/');
  const v1 = u.searchParams.get('v1');
  return { country, lang, productId: v1 ? Number(v1) : null };
}

/** Read the product from the page in a headless browser. */
async function readProductPage(url) {
  const exe = await findBrowser();
  if (!exe) throw new Error('No Chrome/Edge found for the live import (set CHROME_PATH in .env).');
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: 'new',
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--lang=en'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1280, height: 900 });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const t = req.resourceType();
      if (t === 'image' || t === 'media' || t === 'font') req.abort();
      else req.continue();
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => window.zara?.viewPayload?.product?.detail?.colors?.length, { timeout: 30000 });
    return await page.evaluate(() => {
      const cfg = window.zara.appConfig ?? {};
      const p = window.zara.viewPayload.product;
      return {
        storeId: cfg.storeId,
        locale: String(cfg.locale ?? 'en_US').split('@')[0],
        product: {
          id: p.id,
          name: p.name,
          sectionName: p.sectionName,
          familyName: p.familyName,
          subfamilyName: p.subfamilyName,
          displayReference: p.detail?.displayReference,
          detailedComposition: p.detail?.detailedComposition ?? null,
          colors: (p.detail?.colors ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            hexCode: c.hexCode,
            productId: c.productId,
            price: c.price,
            description: c.description,
            sizes: (c.sizes ?? []).map((s) => ({ name: s.name, availability: s.availability })),
            xmedia: (c.xmedia ?? []).map((x) => ({ kind: x.kind, name: x.name, type: x.type, url: x.url ?? x.extraInfo?.deliveryUrl })),
          })),
        },
      };
    });
  } finally {
    await browser.close();
  }
}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function downloadImage(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`image HTTP ${res.status}`);
  await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

const CURRENCY = { ca: 'CA$', us: '$', gb: '£', au: 'A$', in: '₹', jp: '¥' };

/**
 * Import a Zara product link. Saves data/garments/<id>.json and public/img/<id>-*.jpg.
 * @returns the garment JSON
 */
export async function importZara(url, { garmentsDir, imgDir, log = () => {} }) {
  const { country, lang, productId: wantedId } = parseZaraUrl(url);
  log('opening product page in headless browser…');
  const { storeId, locale, product } = await readProductPage(url);
  const color = product.colors.find((c) => c.productId === wantedId) ?? product.colors[0];
  const productId = color.productId;
  log(`product ${product.name} (${color.name}), store ${storeId}`);

  log('fetching size chart…');
  const guide = await getJson(`https://www.zara.com/itxrest/5/catalog/store/${storeId}/product/${productId}/size-measure-guide?locale=${locale}`);
  const chart = mapZaraChart(guide);
  if (!chart) throw new Error(`"${product.name}" has no product measurements on zara.com, so we can't check the fit.`);

  let composition = compositionText(product.detailedComposition);
  if (!composition) {
    try {
      const extra = await getJson(`https://www.zara.com/${country}/${lang}/product/${productId}/extra-detail?ajax=true`);
      composition = compositionFromExtraDetail(extra);
    } catch {
      /* optional */
    }
  }

  // Images: flat product shot ("plain", e.g. …-e1) first, then the main model shot ("full"), then the rest.
  const imgs = color.xmedia.filter((x) => x.type === 'image' && x.url);
  const ordered = [
    ...imgs.filter((x) => x.kind === 'plain'),
    ...imgs.filter((x) => x.kind === 'full'),
    ...imgs.filter((x) => x.kind !== 'plain' && x.kind !== 'full'),
  ];
  const id = buildGarment({ name: product.name, productId, chart }).id;
  const images = [];
  await fs.mkdir(imgDir, { recursive: true });
  for (const [i, x] of ordered.slice(0, 3).entries()) {
    if (!x.url) continue;
    const src = x.url.replace('{width}', '750');
    const file = `${id}-${i + 1}.jpg`;
    try {
      await downloadImage(src, path.join(imgDir, file));
      images.push(`/img/${file}`);
    } catch (e) {
      log(`image ${i + 1} failed: ${e.message}`);
    }
  }

  const garment = buildGarment({
    url,
    productId,
    name: product.name,
    reference: product.displayReference,
    price: color.price,
    currency: CURRENCY[country] ?? '',
    color: color.name,
    description: color.description,
    familyName: product.familyName,
    subfamilyName: product.subfamilyName,
    sectionName: product.sectionName,
    composition,
    images,
    chart,
  });
  garment.sizes_available = Object.fromEntries(color.sizes.map((s) => [s.name, s.availability]));

  await fs.mkdir(garmentsDir, { recursive: true });
  const file = path.join(garmentsDir, `${garment.id}.json`);
  // Re-importing refreshes the product data but keeps what was added by hand (e.g. the 3D `model`).
  const previous = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => null);
  if (previous) for (const [k, v] of Object.entries(previous)) if (!(k in garment)) garment[k] = v;
  await fs.writeFile(file, JSON.stringify(garment, null, 2) + '\n');
  log(`saved ${garment.id}`);
  return garment;
}

async function parseZaraUrlSafe(url) {
  try {
    return parseZaraUrl(url);
  } catch {
    return {};
  }
}

/** extra-detail JSON -> "100% cotton" from the materials section. */
export function compositionFromExtraDetail(sections) {
  const mat = (sections ?? []).find((s) => s.sectionType === 'materials');
  if (!mat) return null;
  const texts = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (o.datatype === 'text' && o.value) texts.push(o.value);
    for (const k of Object.keys(o)) if (typeof o[k] === 'object') walk(o[k]);
  };
  walk(mat.components);
  const line = texts.find((t) => /\d+%/.test(t));
  return line ?? null;
}
