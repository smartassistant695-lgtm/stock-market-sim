// Serverless function: forwards data from the website to Google Sheets.
//
// The iPad only ever talks to this website's own address. This function
// then sends the data on to the Google Apps Script web app, whose URL is
// kept in the SHEETS_URL environment variable (set in the Vercel dashboard),
// so it never appears in browser code.
//
// GET  /api/save  -> health check: { ok, sheetsConfigured }
// POST /api/save  -> body { sheet, batchId, rows: [ {...}, ... ] }

export default async function handler(req, res) {
  const sheetsUrl = process.env.SHEETS_URL;

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, sheetsConfigured: Boolean(sheetsUrl) });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!sheetsUrl) {
    return res.status(500).json({ ok: false, error: 'SHEETS_URL is not set in the Vercel environment variables' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || !Array.isArray(body.rows)) {
    return res.status(400).json({ ok: false, error: 'Expected JSON with a "rows" array' });
  }

  try {
    // Apps Script answers with a redirect to the real result; fetch follows it.
    const reply = await fetch(sheetsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow',
    });
    const text = await reply.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch {
      return res.status(502).json({
        ok: false,
        error: 'Google did not return JSON. Check the Apps Script is deployed as a web app with access "Anyone".',
      });
    }
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'Could not reach Google Apps Script: ' + err.message });
  }
}
