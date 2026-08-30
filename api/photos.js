// Every photo-related server operation, behind one function.
//
// Vercel's Hobby plan allows 12 Serverless Functions per deployment and this
// repo sits exactly on that limit, so the three photo endpoints share a single
// function and dispatch on `?action=`:
//
//   GET  /api/photos?action=download&id=<photoId>  → the image bytes, same-origin
//   POST /api/photos?action=sync   { tripId }      → restore album records from Storage
//   POST /api/photos?action=place  { url }         → Google Places photo as a data URL
//
// Splitting these back into separate files is what broke the build, so keep new
// photo operations here as another action rather than as a new route file.

const { guard } = require('./_auth');
const { getAdmin, getBucket, getTrip, isMember, tripMemberIds } = require('./_photoAccess');
const crypto = require('crypto');

/** Query params. Vercel populates req.query; fall back to parsing the URL so
 *  the route also works behind a plain node server (scripts/dev-server.js). */
function queryOf(req) {
  if (req.query) return req.query;
  const url = new URL(req.url ?? '', 'http://localhost');
  return Object.fromEntries(url.searchParams);
}

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

/* ── action=sync ─────────────────────────────────────────────────────────── */

function downloadUrl(bucketName, path, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/`
    + `${encodeURIComponent(path)}?alt=media&token=${token}`;
}

async function ensureDownloadToken(file, metadata) {
  const existing = metadata?.metadata?.firebaseStorageDownloadTokens;
  if (existing) return String(existing).split(',')[0];

  const token = crypto.randomUUID();
  await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
  return token;
}

function uploadedAtFrom(path, metadata) {
  const name = path.split('/').pop() ?? '';
  const m = /^(\d{10,})_/.exec(name);
  if (m) {
    const ms = Number(m[1]);
    if (Number.isFinite(ms) && ms > 0 && ms < Date.now() + 86_400_000) return new Date(ms);
  }
  if (metadata?.timeCreated) {
    const d = new Date(metadata.timeCreated);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

async function handleSync(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const user = await guard(req, res, { limit: 10, windowMs: 60_000 });
  if (!user) return;

  const admin = getAdmin();
  const bucket = await getBucket();
  if (!admin || !bucket) {
    return res.status(503).json({ error: 'Photo recovery is not configured on the server.' });
  }

  const tripId = (req.body ?? {}).tripId;
  if (!tripId || typeof tripId !== 'string') {
    return res.status(400).json({ error: 'A tripId is required.' });
  }

  try {
    const db = admin.firestore();
    const trip = await getTrip(db, tripId);
    if (!trip) return res.status(404).json({ error: 'Trip not found.' });
    if (!isMember(trip, user)) {
      return res.status(403).json({ error: 'You do not have access to this trip.' });
    }

    // What the album already knows about.
    const existingSnap = await db.collection('photos').where('tripId', '==', tripId).get();
    const knownPaths = new Set();
    for (const d of existingSnap.docs) {
      const path = d.get('storagePath');
      if (path) knownPaths.add(path);
    }

    // Where this trip's photos could live: every current member's folder, plus
    // any uploader the album already references (someone since removed from the
    // trip still has their photos in the album).
    const uids = tripMemberIds(trip);
    for (const d of existingSnap.docs) {
      const uid = d.get('userId');
      if (uid) uids.add(uid);
    }

    const listings = await Promise.all(
      [...uids].map(uid =>
        bucket.getFiles({ prefix: `photos/${uid}/${tripId}/` })
          .then(([files]) => files)
          .catch(() => [])
      )
    );

    const files = listings.flat().filter(f => !f.name.endsWith('/'));
    const orphans = files.filter(f => !knownPaths.has(f.name));

    // Display names for attribution, fetched once per uploader.
    const names = new Map();
    await Promise.all([...uids].map(async uid => {
      try {
        const snap = await db.collection('users').doc(uid).get();
        names.set(uid, snap.get('displayName') || 'Unknown');
      } catch (_) {
        names.set(uid, 'Unknown');
      }
    }));

    let restored = 0;
    const failures = [];
    for (const file of orphans) {
      try {
        const [metadata] = await file.getMetadata();
        if (metadata.contentType && !metadata.contentType.startsWith('image/')) continue;

        const token = await ensureDownloadToken(file, metadata);
        const uid = file.name.split('/')[1] ?? '';
        await db.collection('photos').add({
          tripId,
          userId: uid,
          uploaderName: names.get(uid) ?? 'Unknown',
          url: downloadUrl(bucket.name, file.name, token),
          storagePath: file.name,
          caption: '',
          uploadedAt: admin.firestore.Timestamp.fromDate(uploadedAtFrom(file.name, metadata)),
          recoveredAt: admin.firestore.Timestamp.now(),
        });
        restored++;
      } catch (err) {
        failures.push(`${file.name}: ${err?.message ?? err}`);
      }
    }

    if (failures.length) console.error('[photo-sync] partial failures', failures.slice(0, 5));

    return res.status(200).json({
      inStorage: files.length,
      inAlbum: existingSnap.size,
      restored,
      failed: failures.length,
    });
  } catch (err) {
    console.error('[photo-sync]', err?.message ?? err);
    return res.status(500).json({ error: 'Could not sync photos.' });
  }
}


/* ── action=download ─────────────────────────────────────────────────────── */

function contentDisposition(name) {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function handleDownload(req, res) {
  // Generous limit: saving a selection fetches one photo per request.
  const user = await guard(req, res, { limit: 200, windowMs: 60_000 });
  if (!user) return;

  const admin = getAdmin();
  const bucket = await getBucket();
  if (!admin || !bucket) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(503).json({ error: 'Photo downloads are not configured on the server.' });
  }

  const id = queryOf(req).id;
  if (!id || typeof id !== 'string') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).json({ error: 'A photo id is required.' });
  }

  try {
    const db = admin.firestore();
    const snap = await db.collection('photos').doc(id).get();
    if (!snap.exists) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(404).json({ error: 'Photo not found.' });
    }

    const photo = snap.data();
    const trip = await getTrip(db, photo.tripId);
    if (!isMember(trip, user)) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(403).json({ error: 'You do not have access to this photo.' });
    }

    const file = bucket.file(photo.storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      res.setHeader('Content-Type', 'application/json');
      return res.status(410).json({ error: 'The image file is no longer in storage.' });
    }

    const [metadata] = await file.getMetadata();
    const name = (photo.storagePath.split('/').pop() ?? 'photo.jpg').replace(/^\d+_/, '');
    const [buf] = await file.download();

    res.setHeader('Content-Type', metadata.contentType || 'image/jpeg');
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Content-Disposition', contentDisposition(name || 'photo.jpg'));
    // Private: the bytes are trip-scoped and the response carried an ID token.
    res.setHeader('Cache-Control', 'private, max-age=3600');
    return res.status(200).send(buf);
  } catch (err) {
    console.error('[photo-download]', err?.message ?? err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: 'Could not fetch the photo.' });
  }
}


/* ── action=place ────────────────────────────────────────────────────────── */

async function fetchAllowlisted(startUrl, maxHops = 4) {
  let url = startUrl;
  for (let i = 0; i < maxHops; i++) {
    if (!ALLOWED_HOSTS.includes(new URL(url).host)) {
      throw new Error(`Host not allowed: ${new URL(url).host}`);
    }
    const r = await fetch(url, { redirect: 'manual' });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      url = new URL(r.headers.get('location'), url).toString();
      continue;
    }
    return r;
  }
  throw new Error('Too many redirects');
}

async function handlePlace(req, res) {
  res.setHeader('Content-Type', 'application/json');

  const user = await guard(req, res);
  if (!user) return;

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
    const upstream = await fetchAllowlisted(url);
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
}


/* ── dispatch ────────────────────────────────────────────────────────────── */

const ACTIONS = {
  download: { method: 'GET',  handler: handleDownload },
  sync:     { method: 'POST', handler: handleSync },
  place:    { method: 'POST', handler: handlePlace },
};

module.exports = async (req, res) => {
  const action = ACTIONS[queryOf(req).action];
  if (!action) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(400).json({
      error: `Unknown action. Expected one of: ${Object.keys(ACTIONS).join(', ')}.`,
    });
  }
  if (req.method !== action.method) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  return action.handler(req, res);
};
