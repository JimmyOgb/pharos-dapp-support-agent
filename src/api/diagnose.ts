import { diagnoseTransaction } from '../diagnostics.ts';

export default async function handler(req: any, res: any) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    let hash = '';
    let network = 'pacific';

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
      hash = body.hash || body.txHash || '';
      network = body.network || 'pacific';
    } else {
      hash = (req.query?.hash as string) || (req.query?.txHash as string) || '';
      network = (req.query?.network as string) || 'pacific';
    }

    if (!hash) {
      res.status(400).json({
        error: 'Missing required parameter: hash',
        hint: 'Provide a 0x-prefixed 32-byte transaction hash.',
      });
      return;
    }

    const diagnosis = await diagnoseTransaction(hash, network);
    res.status(200).json(diagnosis);
  } catch (err: any) {
    res.status(500).json({
      error: err.message || 'Internal diagnostic error',
      details: String(err),
    });
  }
}
