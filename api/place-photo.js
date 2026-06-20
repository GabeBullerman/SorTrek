// Fetches a Google Places photo server-side and returns it as a base64 data URL.
//
// The Google Maps JS SDK's PlacePhoto.getUrl() returns a short-lived, signed URL.
// Storing that URL breaks later when the token expires. Instead the client passes
// that (still-valid) URL here at save time; we fetch the bytes server-side (no
// browser CORS limits), and hand them back so the client can upload a permanent
// copy to Firebase Storage.
//
// SSRF guard: only Google-owned image hosts are allowed.

const ALLOWED_HOSTS = [
  'maps.googleapis.com',
  'maps.gstatic.com',
  'lh3.googleusercontent.com',
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
  'lh6.googleusercontent.com',
  'streetviewpixels-pa.googleapis.com',
  'places.googleapis.com',
];

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url } = req.body ?? {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'A photo url is required.' });
  }

  let host;
  try {
    host = new URL(url).host;
  } catch {
    return res.status(400).json({ error: 'Invalid url.' });
  }
  if (!ALLOWED_HOSTS.includes(host)) {
    return res.status(400).json({ error: `Host not allowed: ${host}` });
  }

  try {
    const upstream = await fetch(url, { redirect: 'follow' });
    if (!upstream.ok) {
      return res.status(502).json({ error: `Upstream returned ${upstream.status}` });
    }
    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return res.status(502).json({ error: `Unexpected content type: ${contentType}` });
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    // Guard against anything unreasonably large (covers are small).
    if (buf.length > 8 * 1024 * 1024) {
      return res.status(413).json({ error: 'Image too large.' });
    }
    const dataUrl = `data:${contentType};base64,${buf.toString('base64')}`;
    return res.status(200).json({ dataUrl, contentType, bytes: buf.length });
  } catch (err) {
    console.error('[place-photo]', err?.message ?? err);
    return res.status(500).json({ error: err?.message ?? 'Failed to fetch photo' });
  }
};
