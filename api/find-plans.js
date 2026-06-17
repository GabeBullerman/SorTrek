const { groqChat } = require('./_groq');

/**
 * Searches Tavily for live web results about activities/events in a destination.
 * Returns an array of { title, url, content } results.
 */
async function tavilySearch(query, apiKey, maxResults = 5) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: maxResults,
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Tavily error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return (data.results ?? []).map(r => ({
    title:   r.title   ?? '',
    url:     r.url     ?? '',
    content: r.content ?? '',
  }));
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const groqKey   = process.env.GROQ_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;

  if (!groqKey)   return res.status(500).json({ error: 'GROQ_API_KEY not configured' });
  if (!tavilyKey) return res.status(500).json({ error: 'TAVILY_API_KEY not configured' });

  const { destination, date, dayNumber, totalDays } = req.body ?? {};
  if (!destination) return res.status(400).json({ error: 'Missing destination' });

  const dateObj   = date ? new Date(date) : new Date();
  const monthYear = dateObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const fullDate  = dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  try {
    // Run three live searches in parallel: activities, events, restaurants
    const [activityResults, eventResults, restaurantResults] = await Promise.all([
      tavilySearch(`best things to do in ${destination} ${monthYear}`, tavilyKey),
      tavilySearch(`events happening in ${destination} ${monthYear}`, tavilyKey),
      tavilySearch(`best restaurants to eat in ${destination}`, tavilyKey, 3),
    ]);

    // Combine and truncate search content to keep Groq prompt manageable
    const formatResults = (results) =>
      results.map(r => `SOURCE: ${r.url}\n${r.title}\n${r.content.slice(0, 400)}`).join('\n\n---\n\n');

    const searchContext = `
=== ACTIVITIES & SIGHTS ===
${formatResults(activityResults)}

=== EVENTS ===
${formatResults(eventResults)}

=== RESTAURANTS ===
${formatResults(restaurantResults)}
`.trim();

    // Use Groq to extract structured suggestions from live search data
    const content = await groqChat(groqKey, [
        {
          role: 'system',
          content: `You extract travel activity suggestions from live web search results. Return ONLY a valid JSON array — no markdown, no explanation.

Each object must have:
- "title": name of the activity, place, or event
- "category": one of "activity" | "food" | "transport" | "other"
- "time": suggested start time like "09:00" or null
- "description": 1–2 sentences from the search results describing it. Be specific and factual — reference actual details from the sources.
- "location": specific address or area name (or null)
- "estimatedCost": e.g. "Free", "~€15", "$30–50" (or null)
- "sourceUrl": the URL this came from`,
        },
        {
          role: 'user',
          content: `Destination: ${destination}
Date: ${fullDate} (Day ${dayNumber} of ${totalDays})

Here are live web search results about activities, events, and restaurants in this destination right now:

${searchContext}

Extract 7 varied, specific suggestions from these results. Prioritise things that are currently open or happening around ${monthYear}. Include a mix of sightseeing, food, and local experiences.`,
        },
      ], { maxTokens: 1500 });

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
  } catch (err) {
    console.error('[find-plans]', err?.message ?? err);
    return res.status(500).json({ error: `Failed to fetch live plans: ${err?.message ?? err}` });
  }
};
