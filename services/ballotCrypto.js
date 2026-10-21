import crypto from 'node:crypto';
import { VOTING_SECRET, isProduction } from '../config.js';

let HMAC_SECRET = VOTING_SECRET;
if (!HMAC_SECRET) {
  if (isProduction) {
    throw new Error('FATAL: VOTING_SECRET environment variable is required in production.');
  }
  HMAC_SECRET = crypto.randomBytes(32).toString('hex');
}

/**
 * Generates an unlinked blind ballot token for a specific voting session.
 * The token contains ONLY session_id and a random cryptographic nonce.
 * It contains NO member identifier.
 */
export function generateBallotToken(sessionId) {
  const nonce = crypto.randomBytes(18).toString('hex');
  const payload = `${sessionId}:${nonce}`;
  const signature = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');
  return `${sessionId}.${nonce}.${signature}`;
}

/**
 * Validates a blind ballot token without needing to know who generated it.
 */
export function verifyBallotToken(sessionId, token) {
  if (!token || typeof token !== 'string') return { valid: false, error: 'Token missing' };
  const parts = token.split('.');
  if (parts.length !== 3) return { valid: false, error: 'Malformed token structure' };

  const [tSessionId, nonce, signature] = parts;
  if (parseInt(tSessionId, 10) !== parseInt(sessionId, 10)) {
    return { valid: false, error: 'Token does not match this voting session' };
  }

  const expectedPayload = `${tSessionId}:${nonce}`;
  const expectedSignature = crypto.createHmac('sha256', HMAC_SECRET).update(expectedPayload).digest('hex');

  // Constant-time comparison to prevent timing attacks
  const isMatch = crypto.timingSafeEqual(
    Buffer.from(signature, 'utf8'),
    Buffer.from(expectedSignature, 'utf8')
  );

  if (!isMatch) {
    return { valid: false, error: 'Cryptographic signature verification failed' };
  }

  // Generate SHA-256 hash for used_tokens ledger
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { valid: true, tokenHash };
}
