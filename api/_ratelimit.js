// Rate limiting for the paid/expensive endpoints.
//
// Fixed-window counters held in Firestore so the limit is GLOBAL rather than
// per-instance. The previous implementation was an in-memory Map, which on
// serverless means every cold start and every concurrent instance gets its own
// allowance — an attacker with an account could fan out across instances and
// spend the Groq / Tavily / AviationStack / Plaid budget unmetered.
//
// A counter costs one read + one write per request. That is deliberate: these
// endpoints already cost money per call, so a Firestore op is cheap insurance.
// Unauthenticated endpoints key on IP instead of uid.
const { getAdmin } = require('./_firebaseAdmin');

const COLLECTION = 'rateLimits';

/** In-process memo, purely to spare Firestore a round trip inside one warm
 *  instance. It can only ever make the limit stricter, never looser. */
const localHits = new Map();

function windowStart(now, windowMs) {
  return Math.floor(now / windowMs) * windowMs;
}

/** Firestore document ids can't contain "/" and shouldn't be unbounded. */
function safeKey(key, bucketStart) {
  return `${String(key).replace(/[^\w.@:-]/g, '_').slice(0, 120)}__${bucketStart}`;
}

/**
 * @returns {Promise<{ok:boolean, retryAfter?:number}>}
 */
async function rateLimit(key, { limit = 30, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const start = windowStart(now, windowMs);
  const retryAfter = Math.ceil((start + windowMs - now) / 1000);
  const docId = safeKey(key, start);

  // Cheap local short-circuit for a hot instance.
  const local = localHits.get(docId);
  if (local && local >= limit) return { ok: false, retryAfter };

  const admin = getAdmin();
  if (!admin) {
    // No Admin SDK (e.g. local dev without a service account): fall back to the
    // per-instance count rather than failing open entirely.
    const next = (local ?? 0) + 1;
    localHits.set(docId, next);
    return next > limit ? { ok: false, retryAfter } : { ok: true };
  }

  const ref = admin.firestore().collection(COLLECTION).doc(docId);
  try {
    const count = await admin.firestore().runTransaction(async tx => {
      const snap = await tx.get(ref);
      const n = (snap.exists ? snap.data().count ?? 0 : 0) + 1;
      tx.set(ref, {
        count: n,
        // TTL field: set a Firestore TTL policy on `expiresAt` for this
        // collection so spent windows are reaped automatically.
        expiresAt: new Date(start + windowMs + 60_000),
      });
      return n;
    });
    localHits.set(docId, count);
    if (localHits.size > 2000) localHits.clear();
    return count > limit ? { ok: false, retryAfter } : { ok: true };
  } catch (err) {
    // A limiter outage must not take the feature down with it.
    console.error('[ratelimit]', err?.message ?? err);
    return { ok: true };
  }
}

/** Enforce a limit and send 429 if exceeded. Returns true if the call may go on. */
async function enforceRateLimit(res, key, opts) {
  const r = await rateLimit(key, opts);
  if (!r.ok) {
    res.setHeader('Retry-After', String(r.retryAfter));
    res.status(429).json({ error: 'Too many requests. Please slow down.' });
    return false;
  }
  return true;
}

/** Best-effort client IP, for endpoints with no authenticated user. */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const first = Array.isArray(fwd) ? fwd[0] : String(fwd ?? '').split(',')[0];
  return (first || req.socket?.remoteAddress || 'unknown').trim();
}

module.exports = { rateLimit, enforceRateLimit, clientIp };
