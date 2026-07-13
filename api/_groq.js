// Shared Groq helper. Calls Groq's OpenAI-compatible REST endpoint directly
// with fetch — the groq-sdk client throws "Connection error" in the Vercel
// runtime, but a raw fetch to the same endpoint works reliably.
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Groq production instruct model. NOTE: a reasoning model (e.g. openai/gpt-oss-*)
// breaks these endpoints — it spends the token budget "thinking" and returns
// empty/wrapped output, so the strict-JSON extraction (Find Plans, email scraper)
// yields nothing. This non-reasoning model is what those prompts expect.
// All AI endpoints use it via the default; change here to switch them all.
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';

/**
 * Send a chat completion to Groq and return the assistant's text content.
 * @param {string} apiKey   GROQ_API_KEY
 * @param {Array}  messages OpenAI-style message array
 * @param {object} [opts]   { maxTokens, model }
 * @returns {Promise<string>}
 */
async function groqChat(apiKey, messages, opts = {}) {
  const { maxTokens = 1024, model = DEFAULT_MODEL } = opts;

  const resp = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages }),
  });

  if (!resp.ok) {
    let detail = `Groq returned ${resp.status}`;
    try {
      const body = await resp.json();
      detail = body?.error?.message ?? detail;
    } catch (_) { /* non-JSON error body */ }
    const err = new Error(detail);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? '';
}

module.exports = { groqChat, DEFAULT_MODEL };
