import { randomBytes } from 'node:crypto';
import type { Client, Row } from '@libsql/client';
import { tokenHash } from './cookies.js';

export const CHECK_CODE = /^[0-9a-f]{16}$/;
export const CHECK_LIFETIME_MS = 5 * 60_000;

export function describeCheck(row: Row, now = Date.now()) {
  const remainingMs = Math.max(0, Number(row.expires_at) - now);
  return {
    code: String(row.code),
    cookieId: String(row.cookie_id),
    expiresAt: new Date(Number(row.expires_at)).toISOString(),
    remainingMs,
    status: remainingMs === 0 ? 'expired' : row.confirmed_at === null ? 'pending' : 'confirmed',
    confirmedAt: row.confirmed_at === null ? null : new Date(Number(row.confirmed_at)).toISOString()
  };
}

export async function createCheck(db: Client, cookieId: string, now = Date.now()) {
  // Keep a short history so existing tabs can still see that their check expired.
  await db.execute({ sql: 'DELETE FROM owner_checks WHERE expires_at < ?', args: [now - 86_400_000] });
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = randomBytes(8).toString('hex');
    const verifierToken = randomBytes(32).toString('hex');
    const result = await db.execute({
      sql: `INSERT INTO owner_checks (code, cookie_id, verifier_token_hash, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING *`,
      args: [code, cookieId, tokenHash(verifierToken), now, now + CHECK_LIFETIME_MS]
    });
    if (result.rows[0]) return { check: describeCheck(result.rows[0], now), verifierToken };
  }
  throw new Error('Could not start owner check');
}

export async function findCheck(db: Client, cookieId: string, code: string, verifierToken?: string) {
  const result = await db.execute({
    sql: `SELECT * FROM owner_checks WHERE cookie_id = ? AND code = ?${verifierToken ? ' AND verifier_token_hash = ?' : ''}`,
    args: verifierToken ? [cookieId, code, tokenHash(verifierToken)] : [cookieId, code]
  });
  return result.rows[0];
}

export async function confirmCheck(db: Client, cookieId: string, code: string, ownerToken: string, now = Date.now()) {
  // The code is single-use and bound to this cookie. Recheck ownership atomically.
  const result = await db.execute({
    sql: `UPDATE owner_checks SET confirmed_at = ?
      WHERE cookie_id = ? AND code = ? AND confirmed_at IS NULL AND expires_at > ?
      AND EXISTS (SELECT 1 FROM cookies WHERE id = ? AND owner_token_hash = ?)
      RETURNING *`,
    args: [now, cookieId, code, now, cookieId, tokenHash(ownerToken)]
  });
  return result.rows[0];
}
