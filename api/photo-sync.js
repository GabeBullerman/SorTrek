// Reconciles a trip's photo album against Firebase Storage.
//
// The album is driven by Firestore documents in `photos`, but the images
// themselves live in Storage under `photos/{uid}/{tripId}/{file}`. The two can
// drift apart: an upload whose tab closed between the file landing and the
// document being written leaves a file with no document, and an earlier version
// of the app deleted documents automatically whenever an <img> failed to load —
// which silently removed photos that were still sitting in Storage.
//
// Either way the file is intact and only the record is missing, so this endpoint
// lists what Storage actually holds for the trip and writes back a document for
// anything the album is missing. It runs with the Admin SDK, so it sees every
// uploader's folder regardless of client rules.

const { guard } = require('./_auth');
const { getAdmin, getBucket, getTrip, isMember, tripMemberIds } = require('./_photoAccess');
const crypto = require('crypto');

/** The public download URL Firebase serves for an object, given its token. */
function downloadUrl(bucketName, path, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/`
    + `${encodeURIComponent(path)}?alt=media&token=${token}`;
}

/** Reuse the object's existing download token, minting one if it has none.
 *  This is the same token the client SDK's getDownloadURL() hands out, so a
 *  recovered photo gets a stable URL rather than one that expires. */
async function ensureDownloadToken(file, metadata) {
  const existing = metadata?.metadata?.firebaseStorageDownloadTokens;
  if (existing) return String(existing).split(',')[0];

  const token = crypto.randomUUID();
  await file.setMetadata({ metadata: { firebaseStorageDownloadTokens: token } });
  return token;
}

/** Uploads are named `${Date.now()}_${originalName}` — recover that timestamp
 *  so a restored photo sorts back into its real place in the album. */
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

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

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
};
