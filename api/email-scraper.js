const { groqChat } = require('./_groq');
const { guard } = require('./_auth');

const BOOKING_SENDERS = [
  'airbnb.com', 'booking.com', 'hotels.com', 'marriott.com', 'hilton.com',
  'hyatt.com', 'ihg.com', 'bestwestern.com', 'radisson.com', 'accor.com',
  'united.com', 'delta.com', 'aa.com', 'southwest.com', 'jetblue.com',
  'alaskaair.com', 'spiritair.com', 'ryanair.com', 'easyjet.com', 'britishairways.com',
  'lufthansa.com', 'airfrance.com', 'klm.com', 'emirates.com', 'qatarairways.com',
  'vrbo.com', 'expedia.com', 'kayak.com', 'priceline.com', 'tripadvisor.com',
  'hotels.com', 'trivago.com', 'agoda.com',
  'opentable.com', 'resy.com', 'yelp.com',
  'hertz.com', 'avis.com', 'enterprise.com', 'budget.com', 'nationalcar.com', 'alamo.com', 'sixt.com',
  'carnival.com', 'royalcaribbean.com', 'ncl.com', 'princess.com',
  'amtrak.com', 'eurostar.com',
];

// Decode base64url Gmail body
function decodeBody(data) {
  if (!data) return '';
  try {
    return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

// Recursively extract readable text from Gmail message parts
function extractText(payload, depth = 0) {
  if (!payload || depth > 5) return '';

  const mimeType = payload.mimeType || '';

  if (mimeType === 'text/plain' && payload.body?.data) {
    return decodeBody(payload.body.data);
  }

  if (mimeType === 'text/html' && payload.body?.data) {
    const html = decodeBody(payload.body.data);
    // Strip HTML tags for clean text
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  if (payload.parts?.length) {
    // Prefer plain text parts
    const plain = payload.parts.find(p => p.mimeType === 'text/plain');
    if (plain) return extractText(plain, depth + 1);
    // Fall back to first part
    return payload.parts.map(p => extractText(p, depth + 1)).join('\n');
  }

  return '';
}

async function fetchEmailText(messageId, accessToken) {
  try {
    const r = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!r.ok) return null;
    const msg = await r.json();
    const subject = msg.payload?.headers?.find(h => h.name === 'Subject')?.value ?? '';
    const from    = msg.payload?.headers?.find(h => h.name === 'From')?.value ?? '';
    const body    = extractText(msg.payload);
    // Truncate body to keep Groq prompt manageable
    return `FROM: ${from}\nSUBJECT: ${subject}\n\n${body.slice(0, 3000)}`;
  } catch {
    return null;
  }
}

async function parseEmailWithGroq(apiKey, emailText, destination) {
  const content = await groqChat(apiKey, [
      {
        role: 'system',
        content: `You extract travel booking details from emails. Return ONLY a single valid JSON object — no markdown, no explanation.
Fields:
- "relevant": boolean — true only if this is a booking confirmation/receipt (not marketing)
- "type": "flight" | "hotel" | "airbnb" | "car-rental" | "restaurant" | "other"
- "title": short descriptive title (e.g. "United Airlines ORD→BCN", "Hotel Arts Barcelona")
- "provider": company name (e.g. "United Airlines", "Airbnb", "Marriott")
- "confirmationNumber": confirmation/booking/reservation code or null
- "checkIn": ISO date string YYYY-MM-DD or null (departure date for flights, check-in for hotels)
- "checkOut": ISO date string YYYY-MM-DD or null (return date for flights, check-out for hotels)
- "cost": total amount as number or null
- "currency": ISO 4217 code (e.g. "USD", "EUR") or "USD" if unknown`,
      },
      {
        role: 'user',
        content: `Trip destination: ${destination}\n\nEmail:\n${emailText}`,
      },
    ], { maxTokens: 512 });

  let text = content.trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await guard(req, res);
  if (!user) return;

  const { accessToken, emailText, tripDestination } = req.body ?? {};

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });

  // Paste-in mode: the user pastes a confirmation email's text directly.
  // (The Gmail path below needs Google's restricted-scope verification, so
  // this is the primary import route for now.)
  if (emailText) {
    try {
      const parsed = await parseEmailWithGroq(apiKey, String(emailText).slice(0, 12_000), tripDestination);
      const bookings = parsed?.relevant ? [{ ...parsed, selected: true }] : [];
      return res.status(200).json({ bookings });
    } catch (err) {
      console.error('[email-scraper:paste]', err?.message ?? err);
      return res.status(500).json({ error: 'Could not parse that email. Please try again.' });
    }
  }

  if (!accessToken) return res.status(400).json({ error: 'Missing accessToken or emailText' });

  try {
    // Search Gmail for booking-related emails
    const senderQ  = BOOKING_SENDERS.map(s => `from:${s}`).join(' OR ');
    const subjectQ = 'subject:(confirmation OR booking OR reservation OR receipt OR itinerary OR booked)';
    const query    = `(${senderQ}) ${subjectQ}`;

    const searchRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=20`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!searchRes.ok) {
      return res.status(401).json({ error: 'Gmail access denied. Make sure you granted the correct permission.' });
    }

    const { messages = [] } = await searchRes.json();
    if (messages.length === 0) return res.status(200).json({ bookings: [] });

    // Fetch email content (max 15 to stay within rate limits)
    const emailTexts = await Promise.all(
      messages.slice(0, 15).map(m => fetchEmailText(m.id, accessToken))
    );

    // Parse each with Groq
    const parsed = await Promise.allSettled(
      emailTexts.filter(Boolean).map(t => parseEmailWithGroq(apiKey, t, tripDestination))
    );

    const bookings = parsed
      .filter(r => r.status === 'fulfilled' && r.value?.relevant)
      .map(r => ({ ...r.value, selected: true }));

    return res.status(200).json({ bookings });
  } catch (err) {
    console.error('[email-scraper]', err?.message ?? err);
    return res.status(500).json({ error: 'Email scan failed. Check server logs.' });
  }
};
