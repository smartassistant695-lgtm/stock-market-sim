// Checks the researcher code (the password only the researcher knows).
//
// The real code is kept in the RESEARCHER_CODE environment variable in
// Vercel, never in the website's code. Both codes are turned into SHA-256
// digests first, so they always have the same length, and then compared
// with timingSafeEqual, which takes the same time whether the first or the
// last character is wrong (so the answer time gives nothing away).
// The code is never logged.

import { createHash, timingSafeEqual } from 'node:crypto';

function digest(text) {
  return createHash('sha256').update(String(text), 'utf8').digest();
}

// The code from Vercel. Spaces or a line break pasted at either end are
// ignored, because the pages also trim what the researcher types.
function expectedCode() {
  return (process.env.RESEARCHER_CODE || '').trim();
}

// Returns 'ok', 'missing' (RESEARCHER_CODE is not set) or 'wrong'.
export function checkResearcherCode(code) {
  const expected = expectedCode();
  if (!expected) return 'missing';
  if (typeof code !== 'string' || code.length === 0 || code.length > 200) return 'wrong';
  return timingSafeEqual(digest(code.trim()), digest(expected)) ? 'ok' : 'wrong';
}

// The simulation page keeps the SHA-256 of the code (as hex text) after the
// researcher unlocks it, and sends it with its data to /api/save.
// Returns 'ok', 'missing' or 'wrong', like checkResearcherCode.
export function checkResearcherHash(hex) {
  const expected = expectedCode();
  if (!expected) return 'missing';
  if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/.test(hex)) return 'wrong';
  const expectedHex = digest(expected).toString('hex');
  return timingSafeEqual(digest(hex), digest(expectedHex)) ? 'ok' : 'wrong';
}

// Pause used before answering "wrong code", so guessing is slow.
export function wrongCodeDelay() {
  return new Promise((resolve) => setTimeout(resolve, 400));
}
