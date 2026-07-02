const { getAdmin } = require('../_firebaseAdmin');

/**
 * Daily Vercel cron: sends a check-in push reminder for flights departing in
 * the next ~48h. Uses Firebase Admin (FIREBASE_SERVICE_ACCOUNT) to read
 * bookings + trip members + their saved FCM tokens, and marks each flight as
 * reminded so it isn't notified twice.
 *
 * Protected by CRON_SECRET: Vercel sends `Authorization: Bearer <CRON_SECRET>`
 * on cron invocations when that env var is set.
 */
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const admin = getAdmin();
  if (!admin) return res.status(503).json({ configured: false, error: 'Firebase Admin not configured' });

  const db = admin.firestore();
  const messaging = admin.messaging();
  const now = Date.now();
  const windowEnd = now + 48 * 3600 * 1000;

  try {
    // Single-field range query on checkIn (auto-indexed); filter type in code
    // to avoid needing a composite index.
    const snap = await db.collection('bookings')
      .where('checkIn', '>=', admin.firestore.Timestamp.fromMillis(now))
      .where('checkIn', '<=', admin.firestore.Timestamp.fromMillis(windowEnd))
      .get();

    const flights = snap.docs.filter(d => {
      const b = d.data();
      return b.type === 'flight' && b.status !== 'cancelled' && !b.checkInReminderSent;
    });

    const tokenCache = new Map(); // uid -> token|null

    /** FCM token for a member, or null if they have none / turned reminders off. */
    async function tokenFor(uid) {
      if (tokenCache.has(uid)) return tokenCache.get(uid);
      let token = null;
      const profile = await db.collection('users').doc(uid).get();
      if (profile.exists && profile.data().remindersEnabled !== false) {
        const u = await db.collection('users').doc(uid).collection('private').doc('push').get();
        token = u.exists ? (u.data().fcmToken ?? null) : null;
      }
      tokenCache.set(uid, token);
      return token;
    }

    function memberUidsOf(trip) {
      return new Set([
        trip.userId,
        ...(trip.ownerIds ?? []),
        ...(trip.collaboratorIds ?? []),
      ].filter(Boolean));
    }

    async function tokensFor(trip) {
      const tokens = [];
      for (const uid of memberUidsOf(trip)) {
        const t = await tokenFor(uid);
        if (t) tokens.push(t);
      }
      return tokens;
    }

    let sent = 0;

    for (const docSnap of flights) {
      const b = docSnap.data();

      const tripSnap = await db.collection('trips').doc(b.tripId).get();
      if (!tripSnap.exists) continue;
      const trip = tripSnap.data();

      const tokens = await tokensFor(trip);

      // No one has notifications on — leave it unmarked so it can fire on a
      // later run (still within the window) once someone enables them.
      if (tokens.length === 0) continue;

      const dep = typeof b.checkIn?.toDate === 'function' ? b.checkIn.toDate() : null;
      const when = dep ? dep.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'soon';
      const route = [b.departureAirport, b.arrivalAirport].filter(Boolean).join('→');
      const title = 'Check-in reminder ✈️';
      const body = `${b.flightNumber ? b.flightNumber + ' ' : ''}${route ? route + ' ' : ''}departs ${when}. Check-in may be open now.`;

      const resp = await messaging.sendEachForMulticast({
        tokens,
        notification: { title, body },
        webpush: {
          notification: { icon: '/ClearLogoWhiteCircle.png', badge: '/ClearLogoWhiteCircle.png' },
          fcmOptions: { link: 'https://sortrek.vercel.app/' },
        },
      });
      sent += resp.successCount;

      await docSnap.ref.update({ checkInReminderSent: true });
    }

    // ── Trip-start reminders ("starts tomorrow — time to pack!") ──────────────
    // Covers trips with no flights booked, which the block above never touches.
    const tripSnapshots = await db.collection('trips')
      .where('startDate', '>=', admin.firestore.Timestamp.fromMillis(now))
      .where('startDate', '<=', admin.firestore.Timestamp.fromMillis(windowEnd))
      .get();

    let tripReminders = 0;
    for (const tripDoc of tripSnapshots.docs) {
      const trip = tripDoc.data();
      if (trip.startReminderSent) continue;

      const tokens = await tokensFor(trip);
      if (tokens.length === 0) continue;

      const start = typeof trip.startDate?.toDate === 'function' ? trip.startDate.toDate() : null;
      const when = start ? start.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }) : 'soon';
      const resp = await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: `${trip.name ?? 'Your trip'} starts ${when}! 🧳`,
          body: `${trip.destination ? trip.destination + ' — ' : ''}check the schedule and finish packing.`,
        },
        webpush: {
          notification: { icon: '/ClearLogoWhiteCircle.png', badge: '/ClearLogoWhiteCircle.png' },
          fcmOptions: { link: 'https://sortrek.vercel.app/' },
        },
      });
      tripReminders += resp.successCount;

      await tripDoc.ref.update({ startReminderSent: true });
    }

    return res.status(200).json({
      ok: true,
      flightsConsidered: flights.length,
      notificationsSent: sent,
      tripStartReminders: tripReminders,
    });
  } catch (err) {
    console.error('[flight-reminders]', err?.message ?? err);
    return res.status(500).json({ error: err?.message ?? 'Failed' });
  }
};
