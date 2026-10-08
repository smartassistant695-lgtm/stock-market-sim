// Serverless function: checks the researcher code.
//
// POST /api/researcher  body { code }
//   -> 200 { ok: true }                     right code
//   -> 401 { ok: false, error: 'Wrong code' } (after a short pause, so guessing is slow)
//   -> 500 { ok: false, error }              RESEARCHER_CODE is not set in Vercel

import { checkResearcherCode, wrongCodeDelay } from '../lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const code = req.body && typeof req.body === 'object' ? req.body.code : undefined;
  const result = checkResearcherCode(code);

  if (result === 'missing') {
    return res.status(500).json({ ok: false, error: 'RESEARCHER_CODE is not set in Vercel' });
  }
  if (result !== 'ok') {
    await wrongCodeDelay();
    return res.status(401).json({ ok: false, error: 'Wrong code' });
  }
  return res.status(200).json({ ok: true });
}
