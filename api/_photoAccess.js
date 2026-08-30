// Shared helpers for the photo endpoints: resolving the Storage bucket and
// checking that the caller is a member of the trip a photo belongs to.
const { getAdmin } = require('./_firebaseAdmin');
const { getStorage } = require('firebase-admin/storage');

let cachedBucket;

/** The project's Storage bucket. Prefers FIREBASE_STORAGE_BUCKET; if that isn't
 *  present at runtime, probes the two default bucket names Firebase hands out
 *  (`.firebasestorage.app` for newer projects, `.appspot.com` for older ones).
 *  Returns null when none of them resolve. */
async function getBucket() {
  if (cachedBucket !== undefined) return cachedBucket;

  const projectId = process.env.FIREBASE_PROJECT_ID
    || process.env.GOOGLE_CLOUD_PROJECT
    || '';
  const candidates = [
    process.env.FIREBASE_STORAGE_BUCKET,
    projectId && `${projectId}.firebasestorage.app`,
    projectId && `${projectId}.appspot.com`,
  ].filter(Boolean);

  for (const name of candidates) {
    try {
      const bucket = getStorage().bucket(name);
      const [exists] = await bucket.exists();
      if (exists) {
        cachedBucket = bucket;
        return bucket;
      }
    } catch (_) { /* try the next candidate */ }
  }

  cachedBucket = null;
  return null;
}

/** Trip doc data, or null when it doesn't exist. */
async function getTrip(db, tripId) {
  const snap = await db.collection('trips').doc(tripId).get();
  return snap.exists ? snap.data() : null;
}

/** Mirrors the `isMemberOfTrip` rule in firestore.rules. */
function isMember(trip, user) {
  if (!trip || !user) return false;
  return trip.userId === user.uid
    || (Array.isArray(trip.collaboratorIds) && trip.collaboratorIds.includes(user.uid))
    || (Array.isArray(trip.collaboratorEmails) && !!user.email
        && trip.collaboratorEmails.includes(user.email));
}

/** Every uid that could have uploaded a photo to this trip. */
function tripMemberIds(trip) {
  const ids = new Set();
  if (trip?.userId) ids.add(trip.userId);
  for (const id of trip?.ownerIds ?? []) ids.add(id);
  for (const id of trip?.collaboratorIds ?? []) ids.add(id);
  return ids;
}

module.exports = { getAdmin, getBucket, getTrip, isMember, tripMemberIds };
