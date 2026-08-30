// Serves a trip photo's bytes from our own origin.
//
// Firebase Storage download URLs are cross-origin. That breaks the two things
// people expect from a photo album: `fetch` is blocked unless CORS is set up on
// the bucket, and `<a download>` is ignored for cross-origin URLs — the browser
// just opens the image in a new tab instead of saving it. Streaming the bytes
// through this same-origin endpoint fixes both, so the app can hand the browser
// a real file (and iOS a real File for the native share sheet, which is what
// puts "Save Image" / "Save to Files" in front of the user).
//
// There is no user-supplied URL here, so there is nothing to SSRF: the caller
// passes a photo document id, and the object path comes from that document
// after we've checked the caller is a member of the trip it belongs to.

const { guard } = require('./_auth');
const { getAdmin, getBucket, getTrip, isMember } = require('./_photoAccess');

/** RFC 5987 filename so non-ASCII captions/names survive the header. */
function contentDisposition(name) {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Content-Type', 'application/json');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Generous limit: saving a selection fetches one photo per request.
  const user = await guard(req, res, { limit: 200, windowMs: 60_000 });
  if (!user) return;

  const admin = getAdmin();
  const bucket = await getBucket();
  if (!admin || !bucket) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(503).json({ error: 'Photo downloads are not configured on the server.' });
  }

  const id = req.query?.id;
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
};
