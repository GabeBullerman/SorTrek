// POST /api/plaid — single endpoint for all Plaid operations, selected by
// `action` in the body: "link" | "exchange" | "transactions".
// (Consolidated from three separate routes to stay under Vercel's Hobby-plan
// limit of 12 serverless functions per deployment.)
const { PlaidApi, PlaidEnvironments, Configuration, Products, CountryCode } = require('plaid');
const { guard } = require('./_auth');

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

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await guard(req, res);
  if (!user) return;

  const plaid = plaidClient();
  if (!plaid) return res.status(500).json({ error: 'PLAID_CLIENT_ID and PLAID_SECRET must be set in Vercel.' });

  const { action } = req.body ?? {};

  try {
    if (action === 'link') {
      const { userId } = req.body ?? {};
      const response = await plaid.linkTokenCreate({
        user: { client_user_id: userId ?? user.uid ?? 'user' },
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
      return res.status(200).json({ accessToken: response.data.access_token });
    }

    if (action === 'transactions') {
      const { accessToken, startDate, endDate } = req.body ?? {};
      if (!accessToken) return res.status(400).json({ error: 'Missing accessToken' });
      const response = await plaid.transactionsGet({
        access_token: accessToken,
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
