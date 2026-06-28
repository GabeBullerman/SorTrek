const { groqChat } = require('./_groq');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GROQ_API_KEY is not configured.' });
  }

  const { type, trip, messages, existingItems } = req.body ?? {};
  if (!type || !trip) {
    return res.status(400).json({ error: 'Missing required fields: type, trip' });
  }

  const startDate = new Date(trip.startDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const endDate   = new Date(trip.endDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const durationDays = Math.ceil((new Date(trip.endDate) - new Date(trip.startDate)) / (1000 * 60 * 60 * 24)) + 1;

  try {
    if (type === 'packing') {
      const content = await groqChat(apiKey, [
        {
          role: 'system',
          content: `You are a travel packing assistant. Return ONLY a valid JSON array of packing items — no markdown fences, no explanation. Each item must be an object with exactly these keys: "name" (string), "category" (one of: "documents", "clothing", "electronics", "toiletries", "medicine", "gear", "food", "other"), "quantity" (number).`,
        },
        {
          role: 'user',
          content: `Trip: ${trip.name} to ${trip.destination}\nDuration: ${durationDays} days (${startDate} – ${endDate})\nAlready packing: ${existingItems?.length ? existingItems.join(', ') : 'nothing yet'}\n\nSuggest 20 essential items I haven't already listed. Focus on practical must-haves for this destination and trip length.`,
        },
      ], { maxTokens: 1024 });

      let text = content.trim();
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

      let suggestions = [];
      try {
        suggestions = JSON.parse(text);
        if (!Array.isArray(suggestions)) suggestions = [];
      } catch (_) {
        suggestions = [];
      }

      return res.status(200).json({ suggestions });
    }

    if (type === 'chat') {
      const systemPrompt = `You are a travel assistant built into the SorTrek trip-planning app. You only answer questions related to travel — destinations, packing, itineraries, transport, accommodation, local customs, food, safety, visas, currency, and similar topics. If the user asks about anything unrelated to travel, politely decline and redirect them to their trip.

The user is planning "${trip.name}" — a trip to ${trip.destination} from ${startDate} to ${endDate} (${durationDays} days).

Important: your knowledge has a training cutoff and you do not have access to live data. Always remind users to verify current prices, opening hours, visa requirements, and availability directly with official sources before relying on any specific figures you provide. Give concise, practical advice. Use short paragraphs or bullet points. Avoid generic filler.`;

      const reply = await groqChat(apiKey, [
        { role: 'system', content: systemPrompt },
        ...(messages ?? []).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
      ], { maxTokens: 1024 });

      return res.status(200).json({ reply });
    }

    return res.status(400).json({ error: `Unknown type: ${type}` });
  } catch (err) {
    const detail = err?.message ?? String(err);
    console.error('[ai-advisor]', detail);
    // Don't leak upstream error details to clients in production.
    const body = process.env.NODE_ENV === 'production'
      ? { error: 'AI request failed.' }
      : { error: 'AI request failed.', detail };
    return res.status(500).json(body);
  }
};
