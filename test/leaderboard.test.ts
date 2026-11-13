import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient, type Client } from '@libsql/client';
import { createApp } from '../src/app.js';
import { longestRun, tokenHash } from '../src/cookies.js';
import { createLeaderboard, LEADERBOARD_CACHE_MS, LEADERBOARD_QUERY } from '../src/leaderboard.js';

const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
const origin = 'https://cookies.example';
const secret = () => randomBytes(32).toString('hex');

async function seed(db: Client, sequence: number, streak: number, day = 1, eaten = false) {
  const suffix = [...sequence.toString(2).padStart(12, '0')].map(bit => '2' + bit).join('');
  const id = 'a'.repeat(streak) + 'b' + '01'.repeat(32).slice(0, 64 - streak - 1 - suffix.length) + suffix;
  assert.equal(id.length, 64);
  assert.equal(longestRun(id), streak);
  const created = new Date(Date.UTC(2026, 0, day)).toISOString();
  await db.execute({
    sql: `INSERT INTO cookies (id, owner_token_hash, created_at, max_streak, bites, eaten_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    args: [id, tokenHash(secret()), created, streak, eaten ? 3 : 0, eaten ? created : null]
  });
  return id;
}

async function listen(db: Client) {
  const server = createApp(db, { publicBaseUrl: origin, rateLimits: false }).listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return { server, base: `http://127.0.0.1:${address.port}` };
}

test('existing cookies enter the indexed all-time top ten, including eaten records and deterministic ties', async t => {
  const db = createClient({ url: ':memory:' });
  t.after(() => db.close());
  // Start with the old register, then apply the new schema twice as on restart.
  await db.executeMultiple(schema.replace(/CREATE INDEX IF NOT EXISTS cookies_rarity_ranking[\s\S]*?;/, ''));
  const records = [[2, 1], [7, 4], [8, 6], [6, 3], [6, 2], [6, 2], [5, 1], [4, 5], [4, 1], [3, 2], [3, 1], [2, 2], [1, 1], [2, 3]];
  const ids: string[] = [];
  for (const [index, [streak, day]] of records.entries()) ids.push(await seed(db, index + 1, streak, day, index === 2));
  await db.executeMultiple(schema);
  await db.executeMultiple(schema);
  const { server, base } = await listen(db);
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const response = await fetch(base + '/api/leaderboard');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.cookies.length, 10);
  assert.deepEqual(data.cookies.map((cookie: { id: string }) => cookie.id), [3, 2, 5, 6, 4, 7, 9, 8, 11, 10].map(n => ids[n - 1]));
  assert.deepEqual(data.cookies.map((cookie: { rank: number }) => cookie.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(data.cookies[0].rarity, 'mythic');
  assert.equal(data.cookies[1].rarity, 'mythic');
  assert.equal(data.cookies[0].maxStreak, 8);
  assert.equal(data.cookies[0].stars, 6);
  assert.equal(data.cookies[0].shareUrl, `${origin}/?cookie=${ids[2]}`);
  assert.equal(data.cookies[0].verificationUrl, `${origin}/verify/${ids[2]}`);
  assert.ok(data.refreshAfterMs > 0 && data.refreshAfterMs <= LEADERBOARD_CACHE_MS);
  assert.doesNotMatch(JSON.stringify(data), /owner_token_hash|ownerToken|sessionToken|verifierToken/);
  assert.equal((await db.execute('SELECT count(*) AS total FROM cookies')).rows[0].total, 14);
  assert.equal((await db.execute('SELECT count(*) AS total FROM cookie_issuances')).rows[0].total, 0);

  const plan = (await db.execute('EXPLAIN QUERY PLAN ' + LEADERBOARD_QUERY)).rows.map(row => String(row.detail)).join('\n');
  assert.match(plan, /USING COVERING INDEX cookies_rarity_ranking/);
  assert.doesNotMatch(plan, /TEMP B-TREE/);
  assert.equal((await fetch(base + '/leaderboard.js')).status, 200);
});

test('empty and small registers return only real entries', async t => {
  const db = createClient({ url: ':memory:' });
  t.after(() => db.close());
  await db.executeMultiple(schema);
  const leaderboard = createLeaderboard(db, origin);
  assert.deepEqual((await leaderboard.read()).cookies, []);
  const id = await seed(db, 1, 1);
  leaderboard.invalidate();
  const cookies = (await leaderboard.read()).cookies;
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].id, id);
  assert.equal(cookies[0].rarity, 'common');
  assert.equal(cookies[0].stars, 1);
});

test('visitors share a bounded cache; externally issued records appear when it expires', async t => {
  const db = createClient({ url: ':memory:' });
  t.after(() => db.close());
  await db.executeMultiple(schema);
  await seed(db, 1, 2);
  let now = 1_000, reads = 0;
  const observed = { execute: async (query: string) => { reads++; return db.execute(query); } } as Client;
  const leaderboard = createLeaderboard(observed, origin, () => now);
  await Promise.all(Array.from({ length: 20 }, () => leaderboard.read()));
  assert.equal(reads, 1);
  const rareId = await seed(db, 2, 8);
  now += LEADERBOARD_CACHE_MS - 1;
  const cached = await leaderboard.read();
  assert.equal(cached.cookies.length, 1);
  assert.equal(cached.refreshAfterMs, 1);
  assert.equal(reads, 1);
  now++;
  const fresh = await leaderboard.read();
  assert.equal(fresh.cookies[0].id, rareId);
  assert.equal(fresh.cookies.length, 2);
  assert.equal(reads, 2);
});

test('a successful issuance invalidates the app cache immediately; retries do not add entries', async t => {
  const db = createClient({ url: ':memory:' });
  t.after(() => db.close());
  await db.executeMultiple(schema);
  const { server, base } = await listen(db);
  t.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  assert.deepEqual((await (await fetch(base + '/api/leaderboard')).json()).cookies, []);
  const { sessionToken } = await (await fetch(base + '/api/session', { method: 'POST' })).json();
  const ownerToken = secret();
  const issue = () => fetch(base + '/api/cookies', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cookie-Session': sessionToken }, body: JSON.stringify({ ownerToken })
  });
  const issued = await issue();
  assert.equal(issued.status, 201);
  const { cookie } = await issued.json();
  assert.equal((await (await fetch(base + '/api/leaderboard')).json()).cookies[0].id, cookie.id);
  assert.equal((await issue()).status, 200);
  assert.equal((await (await fetch(base + '/api/leaderboard')).json()).cookies.length, 1);
});

test('failed cache reads can recover; an invalidated in-flight result cannot overwrite a newer snapshot', async () => {
  let attempts = 0;
  let resolveOld!: (value: unknown) => void;
  const old = new Promise(resolve => { resolveOld = resolve; });
  const observed = { execute: async () => {
    attempts++;
    if (attempts === 1) throw new Error('temporary database failure');
    if (attempts === 2) return old;
    return { rows: [] };
  } } as unknown as Client;
  const leaderboard = createLeaderboard(observed, origin);
  await assert.rejects(leaderboard.read(), /temporary database failure/);
  const pending = leaderboard.read();
  leaderboard.invalidate();
  assert.deepEqual((await leaderboard.read()).cookies, []);
  resolveOld({ rows: [{ id: 'a'.repeat(64), created_at: '2026-01-01T00:00:00.000Z', max_streak: 64 }] });
  assert.equal((await pending).cookies.length, 1);
  assert.deepEqual((await leaderboard.read()).cookies, []);
  assert.equal(attempts, 3);
});
