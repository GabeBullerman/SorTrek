// Shared auth + hardening helpers for serverless API routes.
//
// requireAuth(req, res): verifies a Firebase ID token from the
//   `Authorization: Bearer <idToken>` header. Returns the decoded token
//   (with .uid) on success, or sends a 401/503 and returns null. Callers do:
//     const user = await requireAuth(req, res); if (!user) return;
const { getAdmin } = require('./_firebaseAdmin');
const { getAuth } = require('firebase-admin/auth');
const { enforceRateLimit } = require('./_ratelimit');

/** Set baseline security headers on every API response. */
function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
}

async function requireAuth(req, res) {
  const admin = getAdmin();
  if (!admin) {
    res.status(503).json({ error: 'Server auth is not configured.' });
    return null;
  }
  const header = req.headers.authorization || req.headers.Authorization || '';
  const m = /^Bearer (.+)$/.exec(header);
  if (!m) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  try {
    return await getAuth().verifyIdToken(m[1]);
  } catch (_) {
    res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
    return null;
  }
}

/**
 * One-call guard for authenticated, rate-limited endpoints. Sets security
 * headers, requires a valid Firebase ID token, and applies a per-uid rate
 * limit. Returns the decoded user, or null if a response was already sent.
 *   const user = await guard(req, res); if (!user) return;
 */
async function guard(req, res, { limit = 30, windowMs = 60_000 } = {}) {
  setSecurityHeaders(res);
  const user = await requireAuth(req, res);
  if (!user) return null;
  if (!await enforceRateLimit(res, `${req.url?.split("?")[0]}:${user.uid}`, { limit, windowMs })) return null;
  return user;
}

module.exports = { requireAuth, setSecurityHeaders, guard };
