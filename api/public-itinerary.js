const { getAdmin, toIso } = require('./_firebaseAdmin');
const { setSecurityHeaders } = require('./_auth');

/**
 * Read-only public itinerary for a share token. Returns a SANITIZED view of a
 * trip whose owner has enabled public sharing — no costs, confirmation numbers,
 * ticket numbers, passengers, or collaborators.
 *
 * Public view shows: approved AND proposed plans (proposed flagged as "idea"),
 * plus a general "where we're staying" area for a map. It HIDES transportation
 * entirely — no flights, car rentals, trains, transport/drive itinerary items,
 * airports, or flight numbers.
 */
const TRANSPORT_CATEGORIES = new Set(['transport', 'drive']);
const TRANSPORT_BOOKING_TYPES = new Set(['flight', 'car-rental', 'train', 'transport']);
const STAY_BOOKING_TYPES = new Set(['hotel', 'airbnb']);
/**
 * Reduce a possibly-exact address to a GENERAL area for a public map — we don't
 * want to broadcast the exact door of someone's rental. Drops a leading street
 * number + street, keeping the city/region tail. "Rua Augusta 100, Lisbon,
 * Portugal" -> "Lisbon, Portugal"; a bare "Lisbon" is returned unchanged.
 */
function generalArea(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const parts = s.split(',').map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return s;
  // If the first segment looks like a street address (has digits), drop it.
  const first = parts[0];
  const looksLikeStreet = /\d/.test(first);
  const kept = looksLikeStreet ? parts.slice(1) : parts;
  return kept.join(', ');
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  setSecurityHeaders(res);
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

    const [itinSnap, bookSnap, ideaSnap] = await Promise.all([
      db.collection('itinerary').where('tripId', '==', tripId).get(),
      db.collection('bookings').where('tripId', '==', tripId).get(),
      db.collection('tripIdeas').where('tripId', '==', tripId).get(),
    ]);

    const itinerary = itinSnap.docs
      .map(d => d.data())
      // Show approved AND proposed plans, but hide transportation legs.
      .filter(i => !TRANSPORT_CATEGORIES.has((i.category ?? 'other').toLowerCase()))
      .map(i => ({
        date: toIso(i.date),
        startTime: i.startTime ?? null,
        endTime: i.endTime ?? null,
        title: i.title ?? '',
        description: i.description ?? null,
        location: i.location ?? null,
        category: i.category ?? 'other',
        proposed: i.proposed === true,
      }))
      .sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.startTime ?? '').localeCompare(b.startTime ?? ''));

    // Accommodation ("stays") only — transportation bookings are hidden.
    const stays = bookSnap.docs
      .map(d => d.data())
      .filter(b => b.status !== 'suggested' && STAY_BOOKING_TYPES.has((b.type ?? '').toLowerCase()))
      .map(b => ({
        type: b.type ?? 'hotel',
        title: b.title ?? '',
        area: generalArea(b.address),
        checkIn: toIso(b.checkIn),
        checkOut: toIso(b.checkOut),
      }))
      .sort((a, b) => (a.checkIn ?? '').localeCompare(b.checkIn ?? ''));

    // Distinct general areas for the map — one pin per place. Pulls locations
    // from ALL visible plans (not just accommodation) plus the stays, so a trip
    // spread across several cities shows a pin in each. Transport legs excluded.
    const planLocations = itinSnap.docs.map(d => d.data())
      .filter(i => !TRANSPORT_CATEGORIES.has((i.category ?? 'other').toLowerCase()) && i.location)
      .map(i => generalArea(i.location));
    const mapPlaces = [...new Set([...planLocations, ...stays.map(s => s.area)].filter(Boolean))]
      .slice(0, 15);
    // Single-string fallback for the keyless iframe (used only if Maps JS fails).
    const mapArea = mapPlaces.length ? mapPlaces.slice(0, 3).join(' · ') : (trip.destination ?? '');

    // Distinct "cities" for the at-a-glance stat = where you actually stay
    // (accommodation areas), which is more meaningful than every plan pin.
    const cityCount = [...new Set([
      ...itinSnap.docs.map(d => d.data())
        .filter(i => (i.category ?? '').toLowerCase() === 'accommodation' && i.location)
        .map(i => generalArea(i.location)),
      ...stays.map(s => s.area),
    ].filter(Boolean))].length;

    // Inspiration links from the trip's Ideas board (newest first).
    const ideas = ideaSnap.docs
      .map(d => d.data())
      .map(i => ({
        url: i.url ?? '',
        title: i.title ?? null,
        image: i.image ?? null,
        siteName: i.siteName ?? null,
        note: i.note ?? null,
        _ts: i.createdAt?._seconds ?? 0,
      }))
      .filter(i => i.url)
      .sort((a, b) => b._ts - a._ts)
      .slice(0, 12)
      .map(({ _ts, ...rest }) => rest);

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
      stays,
      mapPlaces,
      mapArea,
      cityCount,
      ideas,
    });
  } catch (err) {
    console.error('[public-itinerary]', err?.message ?? err);
    return res.status(500).json({ error: 'Failed to load itinerary.' });
  }
};
