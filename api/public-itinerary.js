const { getAdmin, toIso } = require('./_firebaseAdmin');

/**
 * Read-only public itinerary for a share token. Returns a SANITIZED view of a
 * trip whose owner has enabled public sharing — no costs, confirmation numbers,
 * ticket numbers, passengers, collaborators, or proposed (unapproved) items.
 */
module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const admin = getAdmin();
  if (!admin) {
    return res.status(503).json({ configured: false, error: 'Public sharing is not configured on the server.' });
  }

  const token = String(req.query.token ?? '').trim();
  if (!token) return res.status(400).json({ error: 'Missing token' });

  try {
    const db = admin.firestore();
    // Single-field equality query (auto-indexed) — avoids needing a composite
    // index; the shareEnabled check is done in code below.
    const snap = await db.collection('trips')
      .where('shareToken', '==', token)
      .limit(1)
      .get();

    if (snap.empty) return res.status(404).json({ error: 'This itinerary link is not available.' });

    const tripDoc = snap.docs[0];
    const trip = tripDoc.data();
    const tripId = tripDoc.id;

    if (trip.shareEnabled !== true) {
      return res.status(404).json({ error: 'This itinerary link is not available.' });
    }

    const [itinSnap, bookSnap] = await Promise.all([
      db.collection('itinerary').where('tripId', '==', tripId).get(),
      db.collection('bookings').where('tripId', '==', tripId).get(),
    ]);

    const itinerary = itinSnap.docs
      .map(d => d.data())
      .filter(i => i.proposed !== true) // only approved items
      .map(i => ({
        date: toIso(i.date),
        startTime: i.startTime ?? null,
        endTime: i.endTime ?? null,
        title: i.title ?? '',
        description: i.description ?? null,
        location: i.location ?? null,
        category: i.category ?? 'other',
      }))
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.startTime ?? '').localeCompare(b.startTime ?? ''));

    const bookings = bookSnap.docs
      .map(d => d.data())
      .filter(b => b.status !== 'suggested')
      .map(b => ({
        type: b.type ?? 'other',
        title: b.title ?? '',
        checkIn: toIso(b.checkIn),
        checkOut: toIso(b.checkOut),
        departureAirport: b.departureAirport ?? null,
        arrivalAirport: b.arrivalAirport ?? null,
        flightNumber: b.flightNumber ?? null,
      }))
      .sort((a, b) => (a.checkIn ?? '').localeCompare(b.checkIn ?? ''));

    // Cache at the edge briefly to soften refreshes.
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      trip: {
        name: trip.name ?? 'Trip',
        destination: trip.destination ?? '',
        startDate: toIso(trip.startDate),
        endDate: toIso(trip.endDate),
        coverPhotoUrl: trip.coverPhotoUrl ?? null,
      },
      itinerary,
      bookings,
    });
  } catch (err) {
    console.error('[public-itinerary]', err?.message ?? err);
    return res.status(500).json({ error: 'Failed to load itinerary.' });
  }
};
