const { PlaidApi, PlaidEnvironments, Configuration } = require('plaid');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const clientId = process.env.PLAID_CLIENT_ID;
  const secret   = process.env.PLAID_SECRET;
  const env      = process.env.PLAID_ENV ?? 'sandbox';

  if (!clientId || !secret) {
    return res.status(500).json({ error: 'Plaid not configured.' });
  }

  const { accessToken, startDate, endDate } = req.body ?? {};
  if (!accessToken) return res.status(400).json({ error: 'Missing accessToken' });

  const plaid = new PlaidApi(new Configuration({
    basePath: PlaidEnvironments[env],
    baseOptions: { headers: { 'PLAID-CLIENT-ID': clientId, 'PLAID-SECRET': secret } },
  }));

  try {
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
  } catch (err) {
    console.error('[plaid-transactions]', err?.response?.data ?? err?.message);
    return res.status(500).json({ error: 'Failed to fetch transactions.' });
  }
};
