const { PlaidApi, PlaidEnvironments, Configuration, Products, CountryCode } = require('plaid');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const clientId = process.env.PLAID_CLIENT_ID;
  const secret   = process.env.PLAID_SECRET;
  const env      = process.env.PLAID_ENV ?? 'sandbox';

  if (!clientId || !secret) {
    return res.status(500).json({ error: 'PLAID_CLIENT_ID and PLAID_SECRET must be set in Vercel.' });
  }

  const plaid = new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: { headers: { 'PLAID-CLIENT-ID': clientId, 'PLAID-SECRET': secret } },
  }));

  try {
    const { userId } = req.body ?? {};
    const response = await plaid.linkTokenCreate({
      user: { client_user_id: userId ?? 'user' },
      client_name: 'Wayfarer',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    });
    return res.status(200).json({ link_token: response.data.link_token });
  } catch (err) {
    console.error('[plaid-link]', err?.response?.data ?? err?.message);
    return res.status(500).json({ error: 'Failed to create Plaid link token.' });
  }
};
