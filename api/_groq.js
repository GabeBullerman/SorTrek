// Shared Groq helper. Calls Groq's OpenAI-compatible REST endpoint directly
// with fetch — the groq-sdk client throws "Connection error" in the Vercel
// runtime, but a raw fetch to the same endpoint works reliably.
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
// Groq production model. All AI endpoints use it via the default; change here to
// switch them all.
//
// llama-3.3-70b-versatile was decommissioned on 2026-08-16, which is why every
// AI feature started failing. Groq's named replacements are openai/gpt-oss-120b
// and qwen/qwen3.6-27b, and both are reasoning models — which these endpoints
// can't take as-is: a model that spends its token budget "thinking" returns
// empty or <think>-wrapped output, and the strict-JSON extraction in Find Plans
// and the email scraper then yields nothing.
//
// Qwen is the one that can be turned all the way off: reasoning_effort 'none'
// puts it in non-thinking mode, so it behaves like the instruct model these
// prompts were written for. gpt-oss only goes down to 'low' — it always spends
// some budget thinking — so it stays the weaker fit here.
const DEFAULT_MODEL = 'qwen/qwen3.6-27b';

// Non-thinking mode. Pass `reasoningEffort: 'default'` (or 'low'/'medium'/'high'
// on models that take them) to opt a single call back into reasoning; pass null
// to omit the field entirely for a model that doesn't accept it.
const DEFAULT_REASONING_EFFORT = 'none';

/**
 * Send a chat completion to Groq and return the assistant's text content.
 * @param {string} apiKey   GROQ_API_KEY
 * @param {Array}  messages OpenAI-style message array
 * @param {object} [opts]   { maxTokens, model, reasoningEffort }
 * @returns {Promise<string>}
 */
async function groqChat(apiKey, messages, opts = {}) {
  const {
    maxTokens = 1024,
    model = DEFAULT_MODEL,
    reasoningEffort = DEFAULT_REASONING_EFFORT,
  } = opts;

  const resp = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages,
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
    }),
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
  const message = data.choices?.[0]?.message;
  const content = (message?.content ?? '').trim();

  // Belt and braces: if a model ever does return its chain of thought inline
  // (reasoning left on, or a model that ignores reasoning_effort), strip the
  // <think> block so the JSON-extracting callers still see clean output.
  return content.replace(/^[\s\S]*?<\/think>/, '').trim() || content;
}

module.exports = { groqChat, DEFAULT_MODEL, DEFAULT_REASONING_EFFORT };
