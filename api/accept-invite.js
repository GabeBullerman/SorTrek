// Server-side trip membership. Two actions, both needing the Admin SDK so the
// client can stay locked out of data it shouldn't reach:
//
//   (default) accept — the client used to read the trip directly to verify the
//     invite token, which required a broad read rule. It posts the slug here
//     instead and we add them if the token matches.
//
//   invite — looking a collaborator up by email used to be a client query over
//     the whole `users` collection, which meant any signed-in account could
//     list every user's email. The lookup happens here now, so `users` can deny
//     listing entirely. Only a trip owner may invite.
const { getAdmin } = require('./_firebaseAdmin');
const { FieldValue } = require('firebase-admin/firestore');
const { guard } = require('./_auth');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await guard(req, res);
  if (!user) return;

  const admin = getAdmin();
  if (!admin) return res.status(503).json({ error: 'Server is not configured.' });

  if ((req.body ?? {}).action === 'invite') return inviteByEmail(req, res, admin, user);

  const slug = String((req.body ?? {}).slug ?? '').trim();
  const dot = slug.indexOf('.');
  if (dot === -1) return res.status(400).json({ error: 'Invalid invite link.' });

  const tripId = slug.slice(0, dot);
  const random = slug.slice(dot + 1);
  if (!tripId || !random) return res.status(400).json({ error: 'Invalid invite link.' });

  try {
    const db = admin.firestore();
    const ref = db.collection('trips').doc(tripId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(404).json({ error: 'This invite is no longer valid.' });

    const trip = snap.data();
    // Constant token comparison isn't critical here (random 24-char token), but
    // reject any mismatch outright.
    if (!trip.inviteToken || trip.inviteToken !== random) {
      return res.status(403).json({ error: 'This invite link is invalid or has been revoked.' });
    }

    const uid = user.uid;
    const alreadyMember =
      trip.userId === uid ||
      (trip.ownerIds ?? []).includes(uid) ||
      (trip.collaboratorIds ?? []).includes(uid);

    if (!alreadyMember) {
      await ref.update({
        collaboratorIds: FieldValue.arrayUnion(uid),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    return res.status(200).json({ tripId, tripName: trip.name ?? 'Trip', alreadyMember });
  } catch (err) {
    console.error('[accept-invite]', err?.message ?? err);
    return res.status(500).json({ error: 'Could not process the invite.' });
  }
};

/** Add a registered user to a trip by email. Owner-only, and the only path
 *  that can resolve an email to an account — the client cannot query `users`. */
async function inviteByEmail(req, res, admin, user) {
  const tripId = String((req.body ?? {}).tripId ?? '').trim();
  const email = String((req.body ?? {}).email ?? '').trim().toLowerCase();
  if (!tripId || !email) return res.status(400).json({ error: 'A trip and an email are required.' });

  try {
    const db = admin.firestore();
    const tripSnap = await db.collection('trips').doc(tripId).get();
    if (!tripSnap.exists) return res.status(404).json({ error: 'Trip not found.' });

    // Managing membership is an owner's job, not any member's.
    const trip = tripSnap.data();
    const isOwner = trip.userId === user.uid || (trip.ownerIds ?? []).includes(user.uid);
    if (!isOwner) return res.status(403).json({ error: 'Only a trip owner can invite people.' });

    const found = await db.collection('users').where('email', '==', email).limit(1).get();
    if (found.empty) {
      // Deliberately the same shape as a success-less result rather than an
      // error that confirms whether an address has an account.
      return res.status(200).json({ success: false, message: 'No account found with that email' });
    }

    const invitee = found.docs[0];
    if (invitee.id === user.uid) {
      return res.status(200).json({ success: false, message: "You're already on this trip" });
    }

    await tripSnap.ref.update({
      collaboratorIds: FieldValue.arrayUnion(invitee.id),
      collaboratorEmails: FieldValue.arrayUnion(email),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const name = invitee.data().displayName || email;
    return res.status(200).json({ success: true, message: `${name} added to the trip`, uid: invitee.id });
  } catch (err) {
    console.error('[accept-invite:invite]', err?.message ?? err);
    return res.status(500).json({ error: 'Could not add that person to the trip.' });
  }
}
