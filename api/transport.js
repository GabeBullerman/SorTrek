const Groq = require('groq-sdk');

const DB_API   = 'https://v6.db.transport.rest';
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const AMADEUS_BASE = 'https://test.api.amadeus.com';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function dbGet(path) {
  const res = await fetch(`${DB_API}${path}`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`DB API ${res.status}: ${path}`);
  return res.json();
}

async function findStation(query) {
  const data = await dbGet(`/locations?query=${encodeURIComponent(query)}&results=3&stops=true&addresses=false&poi=false`);
  return data?.[0] ?? null;
}

async function searchJourneys(fromId, toId, departure, results = 5) {
  return dbGet(`/journeys?from=${fromId}&to=${toId}&departure=${encodeURIComponent(departure)}&results=${results}&language=en`);
}

async function getNearbyTransit(lat, lon, distance = 1500) {
  return dbGet(`/stops/nearby?latitude=${lat}&longitude=${lon}&distance=${distance}&results=20`);
}

async function getLocalOptions(lat, lon) {
  const query = `[out:json][timeout:15];
(
  node["amenity"="bicycle_rental"](around:1500,${lat},${lon});
  node["amenity"="bicycle_parking"](around:1500,${lat},${lon});
  node["highway"="bus_stop"](around:1500,${lat},${lon});
  node["railway"="tram_stop"](around:1500,${lat},${lon});
  node["railway"="subway_entrance"](around:1500,${lat},${lon});
  node["amenity"="taxi"](around:1500,${lat},${lon});
  node["amenity"="car_rental"](around:2000,${lat},${lon});
  node["amenity"="car_sharing"](around:2000,${lat},${lon});
  node["amenity"="motorcycle_rental"](around:2000,${lat},${lon});
  node["amenity"="ferry_terminal"](around:3000,${lat},${lon});
);
out body 40;`;

  const res = await fetch(OVERPASS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.elements ?? []).map(e => ({
    type: e.tags?.amenity ?? e.tags?.highway ?? e.tags?.railway ?? 'other',
    name: e.tags?.name ?? e.tags?.['name:en'] ?? null,
    lat:  e.lat,
    lon:  e.lon,
  }));
}

// ── Amadeus ───────────────────────────────────────────────────────────────────

async function getAmadeusToken(clientId, clientSecret) {
  const res = await fetch(`${AMADEUS_BASE}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`,
  });
  if (!res.ok) throw new Error(`Amadeus auth failed: ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description ?? 'Amadeus token missing');
  return data.access_token;
}

async function findAirport(token, cityName) {
  const res = await fetch(
    `${AMADEUS_BASE}/v1/reference-data/locations?keyword=${encodeURIComponent(cityName)}&subType=AIRPORT&page%5Blimit%5D=3`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.data?.[0] ?? null;
}

async function findCityCode(token, cityName) {
  const res = await fetch(
    `${AMADEUS_BASE}/v1/reference-data/locations?keyword=${encodeURIComponent(cityName)}&subType=CITY&page%5Blimit%5D=1`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data.data?.[0] ?? null;
}

async function findHotelsByCity(token, cityCode) {
  const res = await fetch(
    `${AMADEUS_BASE}/v1/reference-data/locations/hotels/by-city?cityCode=${encodeURIComponent(cityCode)}&radius=5&radiusUnit=KM&hotelSource=ALL`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data.data ?? [];
}

async function fetchHotelOffers(token, hotelIds, checkInDate, checkOutDate) {
  const ids = hotelIds.join(',');
  const url = `${AMADEUS_BASE}/v3/shopping/hotel-offers?hotelIds=${encodeURIComponent(ids)}&checkInDate=${checkInDate}&checkOutDate=${checkOutDate}&adults=1&currency=USD`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return [];
  const data = await res.json();
  return data.data ?? [];
}

function parseHotelOffers(offersData, cityCode) {
  const results = [];
  for (const hotelData of offersData) {
    const hotel = hotelData.hotel ?? {};
    const offers = hotelData.offers ?? [];
    if (!offers.length) continue;
    const offer = offers[0];
    const price = offer.price;
    results.push({
      hotelId:   hotel.hotelId ?? hotelData.hotelId ?? null,
      hotelName: hotel.name ?? 'Unknown Hotel',
      cityCode:  hotel.cityCode ?? cityCode,
      checkIn:   offer.checkInDate ?? null,
      checkOut:  offer.checkOutDate ?? null,
      price: price ? {
        amount:   parseFloat(price.total ?? price.base ?? '0'),
        currency: price.currency ?? 'USD',
      } : null,
      rating:    hotel.rating ? parseInt(hotel.rating, 10) : null,
      roomType:  offer.room?.typeEstimated?.bedType ?? offer.room?.description?.text ?? null,
      boardType: offer.boardType ?? null,
    });
  }
  return results;
}

async function searchAmadeusFlights(token, originCode, destinationCode, date, adults = 1) {
  const url = `${AMADEUS_BASE}/v2/shopping/flight-offers?originLocationCode=${originCode}&destinationLocationCode=${destinationCode}&departureDate=${date}&adults=${adults}&max=6&currencyCode=USD`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.errors?.[0]?.detail ?? `Amadeus flights ${res.status}`);
  }
  return res.json();
}

function parseFlightOffers(data, originCode, destinationCode) {
  if (!data?.data?.length) return [];
  return data.data.slice(0, 6).map(offer => {
    const itinerary = offer.itineraries?.[0];
    const segments  = itinerary?.segments ?? [];
    const firstSeg  = segments[0];
    const lastSeg   = segments[segments.length - 1];
    const priceInfo = offer.price;

    return {
      id: offer.id,
      departure:   firstSeg?.departure?.at ?? null,
      arrival:     lastSeg?.arrival?.at ?? null,
      duration:    itinerary?.duration?.replace('PT', '').replace('H', 'h ').replace('M', 'm').trim() ?? null,
      stops:       segments.length - 1,
      airline:     firstSeg?.carrierCode ?? null,
      flightNumber: `${firstSeg?.carrierCode ?? ''}${firstSeg?.number ?? ''}`,
      originCode,
      destinationCode,
      price: priceInfo ? {
        amount:   parseFloat(priceInfo.grandTotal ?? priceInfo.total ?? '0'),
        currency: priceInfo.currency ?? 'USD',
      } : null,
    };
  });
}

// ── Shared formatters ─────────────────────────────────────────────────────────

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function parseJourneys(data) {
  if (!data?.journeys) return [];
  return data.journeys.slice(0, 6).map(j => {
    const legs = j.legs ?? [];
    const first = legs[0];
    const last  = legs[legs.length - 1];
    const depTime  = first?.plannedDeparture ?? first?.departure;
    const arrTime  = last?.plannedArrival   ?? last?.arrival;
    const durationMs = depTime && arrTime
      ? new Date(arrTime) - new Date(depTime)
      : null;
    const durationMin = durationMs ? Math.round(durationMs / 60000) : null;
    const changes = legs.filter(l => l.walking !== true).length - 1;

    return {
      id: `${depTime}-${arrTime}`,
      departure: depTime,
      arrival:   arrTime,
      duration:  durationMin ? formatDuration(durationMin) : null,
      changes,
      legs: legs.map(l => ({
        mode:      l.line?.mode ?? (l.walking ? 'walking' : 'unknown'),
        name:      l.line?.name ?? l.line?.fahrtNr ?? null,
        product:   l.line?.product ?? null,
        from:      l.origin?.name ?? null,
        to:        l.destination?.name ?? null,
        departure: l.plannedDeparture ?? l.departure,
        arrival:   l.plannedArrival   ?? l.arrival,
      })),
      price: j.price ? { amount: j.price.amount, currency: j.price.currency } : null,
    };
  });
}

function summariseLocalOptions(elements) {
  const counts = {};
  for (const e of elements) {
    const label =
      e.type === 'bicycle_rental'      ? 'Bike Share'              :
      e.type === 'bus_stop'            ? 'Bus'                     :
      e.type === 'tram_stop'           ? 'Tram'                    :
      e.type === 'subway_entrance'     ? 'Subway / Metro'          :
      e.type === 'taxi'                ? 'Taxi Stand'              :
      e.type === 'car_rental'          ? 'Car Rental'              :
      e.type === 'car_sharing'         ? 'Car Sharing'             :
      e.type === 'motorcycle_rental'   ? 'Scooter / Moto Rental'   :
      e.type === 'ferry_terminal'      ? 'Ferry'                   : null;
    if (label) counts[label] = (counts[label] ?? 0) + 1;
  }
  return Object.entries(counts).map(([type, count]) => ({ type, count }));
}

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, origin, destination, departure, lat, lon } = req.body ?? {};

  try {
    // ── Search intercity train journeys ──────────────────────────────────────
    if (action === 'search') {
      if (!origin || !destination || !departure) {
        return res.status(400).json({ error: 'Missing origin, destination, or departure' });
      }

      const [fromStation, toStation] = await Promise.all([
        findStation(origin),
        findStation(destination),
      ]);

      if (!fromStation) return res.status(200).json({ journeys: [], error: `Could not find station for "${origin}"` });
      if (!toStation)   return res.status(200).json({ journeys: [], error: `Could not find station for "${destination}"` });

      const data = await searchJourneys(fromStation.id, toStation.id, departure);
      const journeys = parseJourneys(data);

      return res.status(200).json({
        journeys,
        fromStation: { id: fromStation.id, name: fromStation.name },
        toStation:   { id: toStation.id,   name: toStation.name },
      });
    }

    // ── Search flights via Amadeus ────────────────────────────────────────────
    if (action === 'flights') {
      const clientId     = process.env.AMADEUS_CLIENT_ID;
      const clientSecret = process.env.AMADEUS_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return res.status(500).json({ error: 'AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET not configured' });
      }

      const { flightOrigin, flightDestination, flightDate } = req.body;
      if (!flightOrigin || !flightDestination || !flightDate) {
        return res.status(400).json({ error: 'Missing flightOrigin, flightDestination, or flightDate' });
      }

      const token = await getAmadeusToken(clientId, clientSecret);

      // Allow passing raw IATA codes (3-char) or city names
      const isIata = s => /^[A-Z]{3}$/.test(s.trim().toUpperCase());

      const [fromAirport, toAirport] = await Promise.all([
        isIata(flightOrigin)      ? { iataCode: flightOrigin.toUpperCase(),      name: flightOrigin }      : findAirport(token, flightOrigin),
        isIata(flightDestination) ? { iataCode: flightDestination.toUpperCase(), name: flightDestination } : findAirport(token, flightDestination),
      ]);

      if (!fromAirport) return res.status(200).json({ flights: [], error: `No airport found for "${flightOrigin}"` });
      if (!toAirport)   return res.status(200).json({ flights: [], error: `No airport found for "${flightDestination}"` });

      const dateStr = flightDate.slice(0, 10); // ensure YYYY-MM-DD
      const data = await searchAmadeusFlights(token, fromAirport.iataCode, toAirport.iataCode, dateStr);
      const flights = parseFlightOffers(data, fromAirport.iataCode, toAirport.iataCode);

      return res.status(200).json({
        flights,
        fromAirport: { code: fromAirport.iataCode, name: fromAirport.name },
        toAirport:   { code: toAirport.iataCode,   name: toAirport.name },
      });
    }

    // ── Local transport options near a coordinate ─────────────────────────────
    if (action === 'local') {
      if (!lat || !lon) return res.status(400).json({ error: 'Missing lat/lon' });

      const [transitStops, osmElements] = await Promise.all([
        getNearbyTransit(lat, lon, 1500).catch(() => []),
        getLocalOptions(lat, lon).catch(() => []),
      ]);

      const localSummary = summariseLocalOptions(osmElements);

      const nearbyStops = (Array.isArray(transitStops) ? transitStops : [])
        .slice(0, 10)
        .map(s => ({ name: s.name, id: s.id, distance: s.distance, products: s.products }));

      return res.status(200).json({ localSummary, nearbyStops });
    }

    // ── AI transport plan ─────────────────────────────────────────────────────
    if (action === 'plan') {
      const groqKey = process.env.GROQ_API_KEY;
      if (!groqKey) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });

      const { tripName, journeys, localSummary, destination: dest } = req.body;
      const groq = new Groq({ apiKey: groqKey });

      const context = [
        journeys?.length ? `Available trains: ${journeys.slice(0,3).map(j => `${j.departure ? new Date(j.departure).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '?'} → ${j.arrival ? new Date(j.arrival).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'}) : '?'} (${j.duration}, ${j.changes} change${j.changes !== 1 ? 's' : ''})`).join(' | ')}` : 'No train results found.',
        localSummary?.length ? `Local transport at destination: ${localSummary.map(l => `${l.count} ${l.type} stop${l.count !== 1 ? 's' : ''}`).join(', ')}` : 'No local transport data available.',
      ].join('\n');

      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 512,
        messages: [
          {
            role: 'system',
            content: 'You are a concise European travel transport advisor. Give practical, specific advice in 3–5 bullet points. No fluff.',
          },
          {
            role: 'user',
            content: `Trip: ${tripName ?? 'Unknown'} to ${dest ?? 'Unknown'}\n${context}\n\nGive a short transport plan: which train to take, and how to get around locally.`,
          },
        ],
      });

      return res.status(200).json({ plan: response.choices[0].message.content });
    }

    // ── Hotel search via Amadeus ──────────────────────────────────────────────
    if (action === 'hotels') {
      const clientId     = process.env.AMADEUS_CLIENT_ID;
      const clientSecret = process.env.AMADEUS_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return res.status(500).json({ error: 'AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET not configured' });
      }

      const { hotelDestination, hotelCheckIn, hotelCheckOut } = req.body;
      if (!hotelDestination || !hotelCheckIn || !hotelCheckOut) {
        return res.status(400).json({ error: 'Missing hotelDestination, hotelCheckIn, or hotelCheckOut' });
      }

      const token = await getAmadeusToken(clientId, clientSecret);

      // Resolve city IATA code from destination string
      const cityEntry = await findCityCode(token, hotelDestination);
      if (!cityEntry) {
        return res.status(200).json({ hotels: [], error: `Could not resolve city code for "${hotelDestination}"` });
      }
      const cityCode = cityEntry.iataCode ?? cityEntry.address?.cityCode;
      if (!cityCode) {
        return res.status(200).json({ hotels: [], error: `No IATA city code found for "${hotelDestination}"` });
      }

      // Find hotels in that city
      const hotelList = await findHotelsByCity(token, cityCode);
      if (!hotelList.length) {
        return res.status(200).json({ hotels: [], cityCode, error: `No hotels found in ${cityCode}` });
      }

      // Take first 10 hotel IDs and fetch offers
      const hotelIds = hotelList.slice(0, 10).map(h => h.hotelId).filter(Boolean);
      const checkIn  = hotelCheckIn.slice(0, 10);   // ensure YYYY-MM-DD
      const checkOut = hotelCheckOut.slice(0, 10);

      const offersData = await fetchHotelOffers(token, hotelIds, checkIn, checkOut).catch(() => []);
      const hotels = parseHotelOffers(offersData, cityCode);

      return res.status(200).json({ hotels, cityCode });
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('[transport]', err?.message ?? err);
    return res.status(500).json({ error: err?.message ?? 'Transport lookup failed' });
  }
};
