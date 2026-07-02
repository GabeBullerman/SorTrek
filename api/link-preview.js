// POST /api/link-preview { url } — returns { title, description, image, siteName }.
//
// Used by the Ideas board to cache a rich preview when a link is added.
// Strategy: oEmbed for providers that offer it without auth (YouTube, TikTok),
// otherwise fetch the page and read its OpenGraph/Twitter meta tags. Sites
// that block scraping (e.g. Instagram without an FB app token) gracefully
// return nulls and the client renders a plain domain card.
//
// NOTE: this is the 12th serverless function — Vercel's Hobby plan cap.
// The next endpoint added must consolidate an existing one.
const { guard } = require('./_auth');

const FETCH_TIMEOUT_MS = 6000;
const MAX_HTML_BYTES = 300_000;

/** fetch with a hard timeout so a slow site can't hang the function. */
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

/** Providers with public, auth-free oEmbed endpoints. */
function oembedUrlFor(url) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') {
    return `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  }
  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    return `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
  }
  if (host === 'vimeo.com') {
    return `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
  }
  return null;
}

/** First matching meta tag content from raw HTML (property= or name=). */
function metaContent(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m?.[1]) return decodeEntities(m[1].trim());
  }
  return null;
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'");
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await guard(req, res, { limit: 20, windowMs: 60_000 });
  if (!user) return;

  let url = String(req.body?.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  let parsed;
  try {
    parsed = new URL(url);
    // Only fetch public http(s) hosts — never internal addresses.
    if (!/^https?:$/.test(parsed.protocol)) throw new Error('bad protocol');
    if (/^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|\[)/i.test(parsed.hostname)) {
      throw new Error('private host');
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const hostname = parsed.hostname.replace(/^www\./, '');
  const empty = { title: null, description: null, image: null, siteName: hostname };

  try {
    // 1. oEmbed (YouTube, TikTok, Vimeo) — reliable and gives a thumbnail.
    const oembed = oembedUrlFor(url);
    if (oembed) {
      const r = await fetchWithTimeout(oembed);
      if (r.ok) {
        const j = await r.json();
        return res.status(200).json({
          title: j.title ?? null,
          description: j.author_name ? `by ${j.author_name}` : null,
          image: j.thumbnail_url ?? null,
          siteName: j.provider_name ?? hostname,
        });
      }
    }

    // 2. Generic OpenGraph scrape.
    const page = await fetchWithTimeout(url, {
      headers: {
        // A browsery UA gets OG tags from most sites (incl. Pinterest).
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!page.ok) return res.status(200).json(empty);

    const reader = page.body.getReader();
    let html = '';
    while (html.length < MAX_HTML_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      html += Buffer.from(value).toString('utf8');
    }
    reader.cancel().catch(() => {});

    const title = metaContent(html, 'og:title')
      ?? metaContent(html, 'twitter:title')
      ?? (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() || null);
    const description = metaContent(html, 'og:description') ?? metaContent(html, 'twitter:description');
    let image = metaContent(html, 'og:image') ?? metaContent(html, 'twitter:image');
    if (image && image.startsWith('//')) image = `https:${image}`;
    if (image && image.startsWith('/')) image = `${parsed.origin}${image}`;
    const siteName = metaContent(html, 'og:site_name') ?? hostname;

    return res.status(200).json({ title, description, image, siteName });
  } catch (err) {
    // Preview is best-effort — never fail the add.
    return res.status(200).json(empty);
  }
};
