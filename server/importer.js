// Best-effort product import from a store link.
// Zara sits behind bot protection, so this often fails; the UI then offers the saved demo items.
// When it does work we get name/images from the page's meta tags / JSON-LD. Size charts are
// almost never in the HTML, so we return `sizes: null` and let the user pick a saved chart.

const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export async function importProduct(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 12000);
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (e) {
    throw new Error(`Could not reach the store (${e.name === 'AbortError' ? 'timed out' : e.message}).`);
  } finally {
    clearTimeout(t);
  }
  if (res.status === 403 || res.status === 429) throw new Error(`The store blocked the request (HTTP ${res.status}).`);
  if (!res.ok) throw new Error(`Store returned HTTP ${res.status}.`);
  const html = await res.text();
  if (/access denied|captcha|bot detection/i.test(html.slice(0, 5000))) throw new Error('The store showed a bot-protection page.');

  const meta = (prop) => {
    const m =
      html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i')) ||
      html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
    return m ? decodeEntities(m[1]) : null;
  };

  const product = {
    url,
    name: meta('og:title') || (html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? '').trim() || null,
    brand: meta('og:site_name') || new URL(url).hostname.replace(/^www\./, ''),
    images: [meta('og:image')].filter(Boolean),
    fabric: null,
    sizes: null,
    partial: true,
  };

  // JSON-LD often carries name/brand/image/material.
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      const items = Array.isArray(data) ? data : [data];
      for (const d of items) {
        if (d['@type'] !== 'Product') continue;
        product.name ||= d.name;
        product.brand = d.brand?.name ?? product.brand;
        if (d.image) product.images = [].concat(d.image).slice(0, 6);
        product.fabric ||= d.material ?? null;
        product.description = d.description?.slice(0, 300);
      }
    } catch {
      /* ignore bad JSON-LD */
    }
  }

  if (product.name) product.name = decodeEntities(product.name).replace(/\s+/g, ' ').trim();
  if (!product.name) throw new Error('Reached the page but it had no product details (probably a bot-protection shell).');
  return product;
}

function decodeEntities(s) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
