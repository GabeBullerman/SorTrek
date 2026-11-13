// POST /api/plaid — single endpoint for all Plaid operations, selected by
// `action` in the body: "link" | "exchange" | "transactions" | "status" |
// "disconnect".
// (Consolidated into one route to stay under Vercel's Hobby-plan limit of 12
// serverless functions per deployment.)
//
// SECURITY: the Plaid access token is a long-lived credential to a user's bank
// account and never leaves this server. It is written with the Admin SDK to
// `plaidItems/{uid}`, a collection with no client rule at all (Firestore denies
// by default), and every read of it is keyed on the uid from the verified ID
// token. The client cannot read it, send it, or name someone else's.
const { PlaidApi, PlaidEnvironments, Configuration, Products, CountryCode } = require('plaid');
const { guard } = require('./_auth');
const { getAdmin } = require('./_firebaseAdmin');

/** Server-only collection. Deliberately absent from firestore.rules. */
const ITEMS = 'plaidItems';
/** Where tokens used to live — client-readable, so these are considered burned. */
const LEGACY_ITEMS = 'plaid_tokens';

function plaidClient() {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret   = process.env.PLAID_SECRET;
  const env      = process.env.PLAID_ENV ?? 'sandbox';
  if (!clientId || !secret) return null;
  return new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: { headers: { 'PLAID-CLIENT-ID': clientId, 'PLAID-SECRET': secret } },
  }));
}

/**
 * The caller's access token, by uid — never from the request.
 *
 * Tokens stored by the old client-side flow are migrated on first use: they are
 * moved into the server-only collection and the client-readable copy deleted,
 * so a user who connected before this change doesn't have to re-link. They were
 * exposed to the browser while they lived there, so `compromised` marks them
 * for re-linking.
 */
async function accessTokenFor(db, uid) {
  const snap = await db.collection(ITEMS).doc(uid).get();
  if (snap.exists && snap.data().accessToken) {
    return { token: snap.data().accessToken, compromised: !!snap.data().migratedFromClientStorage };
  }

  const legacy = await db.collection(LEGACY_ITEMS).doc(uid).get();
  if (!legacy.exists || !legacy.data().accessToken) return { token: null, compromised: false };

  const token = legacy.data().accessToken;
  await db.collection(ITEMS).doc(uid).set({
    accessToken: token,
    migratedFromClientStorage: true,
    migratedAt: new Date(),
  });
  await db.collection(LEGACY_ITEMS).doc(uid).delete().catch(() => { /* best effort */ });
  return { token, compromised: true };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await guard(req, res);
  if (!user) return;

  const admin = getAdmin();
  if (!admin) return res.status(503).json({ error: 'Server storage is not configured.' });
  const db = admin.firestore();

  const plaid = plaidClient();
  if (!plaid) return res.status(500).json({ error: 'PLAID_CLIENT_ID and PLAID_SECRET must be set in Vercel.' });

  const { action } = req.body ?? {};

  try {
    if (action === 'link') {
      // client_user_id comes from the verified token, never the request body.
      const response = await plaid.linkTokenCreate({
        user: { client_user_id: user.uid },
        client_name: 'SorTrek',
        products: [Products.Transactions],
        country_codes: [CountryCode.Us],
        language: 'en',
      });
      return res.status(200).json({ link_token: response.data.link_token });
    }

    if (action === 'exchange') {
      const { publicToken } = req.body ?? {};
      if (!publicToken) return res.status(400).json({ error: 'Missing publicToken' });

      const response = await plaid.itemPublicTokenExchange({ public_token: publicToken });
      // Stored here and nowhere else. The response carries no token.
      await db.collection(ITEMS).doc(user.uid).set({
        accessToken: response.data.access_token,
        itemId: response.data.item_id ?? null,
        connectedAt: new Date(),
      });
      return res.status(200).json({ connected: true });
    }

    if (action === 'status') {
      const { token, compromised } = await accessTokenFor(db, user.uid);
      return res.status(200).json({ connected: !!token, shouldRelink: compromised });
    }

    if (action === 'disconnect') {
      const { token } = await accessTokenFor(db, user.uid);
      if (token) {
        // Invalidate at Plaid too, so a leaked copy of the token is useless.
        await plaid.itemRemove({ access_token: token }).catch(err => {
          console.error('[plaid:disconnect] itemRemove failed', err?.response?.data ?? err?.message);
        });
      }
      await db.collection(ITEMS).doc(user.uid).delete().catch(() => {});
      await db.collection(LEGACY_ITEMS).doc(user.uid).delete().catch(() => {});
      return res.status(200).json({ connected: false });
    }

    if (action === 'transactions') {
      const { startDate, endDate } = req.body ?? {};
      const { token } = await accessTokenFor(db, user.uid);
      if (!token) return res.status(200).json({ transactions: [] });

      const response = await plaid.transactionsGet({
        access_token: token,
        start_date: startDate ?? new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
        end_date:   endDate   ?? new Date().toISOString().split('T')[0],
        options: { count: 100 },
      });
      const transactions = response.data.transactions.map(tx => ({
        id:          tx.transaction_id,
        date:        tx.date,
        name:        tx.name,
        amount:      tx.amount,
        currency:    tx.iso_currency_code ?? 'USD',
        category:    tx.personal_finance_category?.primary ?? tx.category?.[0] ?? 'other',
        merchant:    tx.merchant_name ?? tx.name,
        pending:     tx.pending,
        lat:         tx.location?.lat ?? null,
        lon:         tx.location?.lon ?? null,
      }));
      return res.status(200).json({ transactions });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    console.error(`[plaid:${action}]`, err?.response?.data ?? err?.message);
    return res.status(500).json({ error: `Plaid ${action ?? 'request'} failed.` });
  }
};
