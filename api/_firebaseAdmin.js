// Shared Firebase Admin initializer for serverless API routes.
// Set FIREBASE_SERVICE_ACCOUNT in the environment to the service-account JSON
// (raw JSON or base64). Returns null when not configured so callers can
// degrade gracefully instead of crashing.
//
// firebase-admin v13+ removed the legacy namespaced API (admin.credential.cert,
// admin.firestore(), …) in favor of modular subpath imports. We use those and
// expose a tiny shim so callers can keep using admin.firestore() /
// admin.messaging() / admin.firestore.Timestamp.
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { getMessaging } = require('firebase-admin/messaging');

// Compatibility shim mirroring the old namespaced surface the callers use.
const firestoreFn = () => getFirestore();
firestoreFn.Timestamp = Timestamp;
const adminShim = {
  firestore: firestoreFn,
  messaging: () => getMessaging(),
};

function getAdmin() {
  if (getApps().length) return adminShim;

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) return null;

  let creds;
  try {
    creds = JSON.parse(raw);
  } catch (_) {
    try {
      creds = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    } catch (_) {
      return null;
    }
  }

  // Private keys pasted into env often have literal \n — normalize them.
  if (creds.private_key) creds.private_key = creds.private_key.replace(/\\n/g, '\n');

  try {
    initializeApp({ credential: cert(creds) });
    return adminShim;
  } catch (_) {
    return null;
  }
}

/** Firestore Timestamp (admin or plain) → ISO string, or null. */
function toIso(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  if (ts._seconds != null) return new Date(ts._seconds * 1000).toISOString();
  return null;
}

module.exports = { getAdmin, toIso };
