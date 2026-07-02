// POST /api/delete-account — permanently erases the calling user's account.
//
// Requires a FRESH sign-in (client reauthenticates immediately before calling;
// we also verify auth_time server-side). Removes, in order:
//   1. Trips the user owns + every related doc (bookings, itinerary, expenses,
//      participants, packing, documents, photos) + their Storage files
//   2. Photos/documents the user uploaded to OTHER people's trips (+ files)
//   3. The user from other trips' collaborator/owner/editor arrays
//   4. Participant records and pending invites for their email
//   5. Plaid access token (plaid_tokens/{uid})
//   6. Private subcollection (FCM tokens) and the profile doc
//   7. Storage under avatars/{uid}/ and photos/{uid}/
//   8. The Firebase Auth user itself
// Gmail access is never stored server-side (ephemeral popup token only), so
// there is nothing to revoke here.
const { guard } = require('./_auth');
const { getAdmin } = require('./_firebaseAdmin');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');
const { FieldValue } = require('firebase-admin/firestore');

const TRIP_COLLECTIONS = [
  'bookings', 'itinerary', 'expenses', 'participants', 'packingItems', 'tripDocuments', 'photos',
];
// Doc field that holds the Storage object path, per collection that has files.
const STORAGE_PATH_FIELD = { photos: 'storagePath', tripDocuments: 'storagePath' };

function bucketName() {
  if (process.env.FIREBASE_STORAGE_BUCKET) return process.env.FIREBASE_STORAGE_BUCKET;
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    const creds = JSON.parse(/^\s*\{/.test(raw) ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    return `${creds.project_id}.firebasestorage.app`;
  } catch (_) {
    return null;
  }
}

/** Delete every doc in a query snapshot in batches of 400. */
async function deleteDocs(db, snap) {
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    docs.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}

/** Best-effort delete of individual Storage objects by path. */
async function deleteFiles(bucket, paths) {
  if (!bucket) return;
  await Promise.allSettled(paths.filter(Boolean).map(p => bucket.file(p).delete()));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await guard(req, res, { limit: 3, windowMs: 60_000 });
  if (!user) return;

  // Deletion is irreversible — require a sign-in within the last 10 minutes so
  // a stolen long-lived token alone can't erase an account.
  const ageSec = Date.now() / 1000 - (user.auth_time ?? 0);
  if (ageSec > 10 * 60) {
    return res.status(403).json({ error: 'Recent sign-in required. Please re-enter your password and try again.' });
  }

  const admin = getAdmin();
  if (!admin) return res.status(503).json({ error: 'Server is not configured.' });
  const db = admin.firestore();
  const uid = user.uid;
  const email = (user.email || '').trim().toLowerCase();

  let bucket = null;
  try {
    const name = bucketName();
    if (name) bucket = getStorage().bucket(name);
  } catch (_) { /* storage cleanup is best-effort */ }

  try {
    // 1. Trips the user owns — wipe each trip and all its related documents.
    const owned = await db.collection('trips').where('userId', '==', uid).get();
    for (const tripDoc of owned.docs) {
      for (const coll of TRIP_COLLECTIONS) {
        const snap = await db.collection(coll).where('tripId', '==', tripDoc.id).get();
        const pathField = STORAGE_PATH_FIELD[coll];
        if (pathField) {
          await deleteFiles(bucket, snap.docs.map(d => d.get(pathField)));
        }
        await deleteDocs(db, snap);
      }
      await tripDoc.ref.delete();
    }

    // 2. Photos/documents this user uploaded to trips they don't own.
    for (const coll of ['photos', 'tripDocuments']) {
      const snap = await db.collection(coll).where('userId', '==', uid).get();
      await deleteFiles(bucket, snap.docs.map(d => d.get('storagePath')));
      await deleteDocs(db, snap);
    }

    // 3. Remove the user from other trips' membership arrays.
    const memberQueries = [
      db.collection('trips').where('collaboratorIds', 'array-contains', uid).get(),
      db.collection('trips').where('ownerIds', 'array-contains', uid).get(),
    ];
    const memberSnaps = await Promise.all(memberQueries);
    const memberRefs = new Map();
    memberSnaps.forEach(s => s.docs.forEach(d => memberRefs.set(d.id, d.ref)));
    for (const ref of memberRefs.values()) {
      const changes = {
        collaboratorIds: FieldValue.arrayRemove(uid),
        ownerIds: FieldValue.arrayRemove(uid),
        scheduleEditorIds: FieldValue.arrayRemove(uid),
      };
      if (email) changes.collaboratorEmails = FieldValue.arrayRemove(email);
      await ref.update(changes);
    }

    // 4. Participant records + pending invites addressed to their email.
    await deleteDocs(db, await db.collection('participants').where('userId', '==', uid).get());
    if (email) {
      await deleteDocs(db, await db.collection('participants').where('email', '==', email).get());
    }

    // 5. Plaid access token — the most sensitive stored credential.
    await db.doc(`plaid_tokens/${uid}`).delete();

    // 6. Private subcollection (FCM tokens etc.) then the profile itself.
    await deleteDocs(db, await db.collection(`users/${uid}/private`).get());
    await db.doc(`users/${uid}`).delete();

    // 7. Storage owned by the user (avatar + any remaining photo objects).
    if (bucket) {
      await Promise.allSettled([
        bucket.deleteFiles({ prefix: `avatars/${uid}/` }),
        bucket.deleteFiles({ prefix: `photos/${uid}/` }),
        bucket.deleteFiles({ prefix: `documents/${uid}/` }),
        bucket.deleteFiles({ prefix: `coverPhotos/${uid}/` }),
      ]);
    }

    // 8. Finally, the Auth account.
    await getAuth().deleteUser(uid);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('delete-account failed', err);
    return res.status(500).json({ error: 'Account deletion failed. Please try again.' });
  }
};
