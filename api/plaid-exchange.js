const { PlaidApi, PlaidEnvironments, Configuration } = require('plaid');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const clientId = process.env.PLAID_CLIENT_ID;
  const secret   = process.env.PLAID_SECRET;
  const env      = process.env.PLAID_ENV ?? 'sandbox';

  if (!clientId || !secret) return res.status(500).json({ error: 'Plaid not configured.' });

  const { publicToken } = req.body ?? {};
  if (!publicToken) return res.status(400).json({ error: 'Missing publicToken' });

  const plaid = new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: { headers: { 'PLAID-CLIENT-ID': clientId, 'PLAID-SECRET': secret } },
  }));

  try {
    const response = await plaid.itemPublicTokenExchange({ public_token: publicToken });
    return res.status(200).json({ accessToken: response.data.access_token });
  } catch (err) {
    console.error('[plaid-exchange]', err?.response?.data ?? err?.message);
    return res.status(500).json({ error: 'Token exchange failed.' });
  }
};
