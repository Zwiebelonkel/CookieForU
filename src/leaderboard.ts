import type { Client } from '@libsql/client';
import { rarity } from './cookies.js';

export const LEADERBOARD_CACHE_MS = 30_000;
export const LEADERBOARD_QUERY = `SELECT id, created_at, max_streak FROM cookies
  ORDER BY max_streak DESC, created_at ASC, id ASC LIMIT 10`;

async function readTopCookies(db: Client, origin: string) {
  const result = await db.execute(LEADERBOARD_QUERY);
  return result.rows.map((row, index) => {
    const id = String(row.id);
    const maxStreak = Number(row.max_streak);
    const level = rarity(maxStreak);
    return {
      rank: index + 1,
      id,
      createdAt: String(row.created_at),
      maxStreak,
      rarity: level.name,
      stars: Math.max(1, Math.min(6, maxStreak - 1)),
      rarityProbabilityPercent: level.percent,
      shareUrl: `${origin}/?cookie=${id}`,
      verificationUrl: `${origin}/verify/${id}`
    };
  });
}

// One small cache per app; concurrent visitors share the same database read.
// Other server instances' new records become visible after at most 30 seconds.
export function createLeaderboard(db: Client, origin: string, now = Date.now) {
  type Snapshot = { cookies: Awaited<ReturnType<typeof readTopCookies>>; expiresAt: number };
  let cached: Snapshot | undefined;
  let pending: Promise<Snapshot> | undefined;
  let generation = 0;

  return {
    async read() {
      let snapshot = cached;
      if (!snapshot || snapshot.expiresAt <= now()) {
        if (!pending) {
          const version = generation;
          const request = readTopCookies(db, origin).then(cookies => {
            const fresh = { cookies, expiresAt: now() + LEADERBOARD_CACHE_MS };
            if (version === generation) cached = fresh;
            return fresh;
          }).finally(() => {
            if (pending === request) pending = undefined;
          });
          pending = request;
        }
        snapshot = await pending;
      }
      return { cookies: snapshot.cookies, refreshAfterMs: Math.max(0, snapshot.expiresAt - now()) };
    },
    invalidate() {
      generation++;
      cached = undefined;
      pending = undefined;
    }
  };
}
