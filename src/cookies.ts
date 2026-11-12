import { randomBytes, createHash } from 'node:crypto';
import type { Client, Row } from '@libsql/client';

export const HEX_ID = /^[0-9a-f]{64}$/;
export const RULES_VERSION = 1;
const levels = [
  { name: 'common', percent: '79.503905720228', oneIn: 1.2578 },
  { name: 'uncommon', percent: '19.107037165713', oneIn: 5.233674 },
  { name: 'rare', percent: '1.303162640682', oneIn: 76.736393 },
  { name: 'epic', percent: '0.080613616519', oneIn: 1240.485222 },
  { name: 'legendary', percent: '0.004956384488', oneIn: 20175.997292 },
  { name: 'mythic', percent: '0.000324472370', oneIn: 308192.651453 }
];

export function longestRun(id: string): number {
  return Math.max(1, ...(id.match(/(.)\1*/g) ?? []).map(run => run.length));
}

export function rarity(streak: number) {
  return levels[Math.max(0, Math.min(5, streak - 2))];
}

export function tokenHash(token: string) {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function describe(row: Row, origin: string) {
  const id = String(row.id);
  const bites = Number(row.bites);
  return {
    id,
    issued: true,
    createdAt: String(row.created_at),
    maxStreak: Number(row.max_streak),
    rulesVersion: Number(row.rules_version),
    rarity: rarity(Number(row.max_streak)).name,
    rarityProbabilityPercent: rarity(Number(row.max_streak)).percent,
    rarityOneIn: rarity(Number(row.max_streak)).oneIn,
    bites,
    bitesRemaining: 3 - bites,
    remainingHash: id.slice(0, Math.floor(64 * (3 - bites) / 3)),
    status: bites === 3 ? 'eaten' : bites === 0 ? 'whole' : 'bitten',
    eatenAt: row.eaten_at === null ? null : String(row.eaten_at),
    shareUrl: `${origin}/?cookie=${id}`,
    verificationUrl: `${origin}/verify/${id}`,
    certificateUrl: `${origin}/api/cookies/${id}/certificate`
  };
}

export async function findCookie(db: Client, id: string) {
  const result = await db.execute({ sql: 'SELECT * FROM cookies WHERE id = ?', args: [id] });
  return result.rows[0];
}

export async function issueCookie(db: Client, ownerToken: string) {
  const ownerHash = tokenHash(ownerToken);
  // A retry with the same secret token returns the same cookie.
  // The browser can choose a token, but never a cookie ID or rarity.
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = randomBytes(32).toString('hex');
    const results = await db.batch([
      {
        sql: `INSERT INTO cookies
          (id, owner_token_hash, created_at, max_streak, rules_version)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        args: [id, ownerHash, new Date().toISOString(), longestRun(id), RULES_VERSION]
      },
      { sql: 'SELECT * FROM cookies WHERE owner_token_hash = ?', args: [ownerHash] }
    ], 'write');
    if (results[1].rows[0]) {
      return { row: results[1].rows[0], created: results[0].rowsAffected === 1 };
    }
  }
  throw new Error('Cookie issuance failed');
}

export async function takeBite(db: Client, id: string, ownerToken: string, expectedBites: number) {
  const result = await db.execute({
    sql: `UPDATE cookies SET
      bites = bites + 1,
      eaten_at = CASE WHEN bites = 2 THEN ? ELSE eaten_at END
      WHERE id = ? AND owner_token_hash = ? AND bites = ? AND bites < 3
      RETURNING *`,
    args: [new Date().toISOString(), id, tokenHash(ownerToken), expectedBites]
  });
  return result.rows[0];
}
