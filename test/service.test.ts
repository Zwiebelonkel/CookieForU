import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';
import { createApp } from '../src/app.js';
import { longestRun, rarity } from '../src/cookies.js';

test('cookie service with a real local libSQL database', async t => {
  const db = createClient({ url: ':memory:' });
  await db.executeMultiple(await readFile(new URL('../schema.sql', import.meta.url), 'utf8'));
  const app = createApp(db, {
    publicBaseUrl: 'https://cookies.example',
    corsOrigin: 'https://luca.github.io',
    rateLimits: false
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  const secret = () => randomBytes(32).toString('hex');
  const post = (path: string, body: object, token?: string) => fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body)
  });
  async function issue(ownerToken = secret()) {
    const response = await post('/api/cookies', { ownerToken });
    assert.equal(response.status, 201);
    return { cookie: (await response.json()).cookie, ownerToken };
  }

  try {
    await t.test('server generates IDs and rejects client-selected rare IDs', async () => {
      const { cookie } = await issue();
      assert.match(cookie.id, /^[0-9a-f]{64}$/);
      assert.equal(cookie.remainingHash, cookie.id);
      assert.equal(cookie.maxStreak, longestRun(cookie.id));
      assert.equal(cookie.rarity, rarity(cookie.maxStreak).name);
      assert.equal(cookie.shareUrl, `https://cookies.example/?cookie=${cookie.id}`);
      assert.equal(cookie.owner_token_hash, undefined);
      assert.equal(cookie.ownerToken, undefined);
      assert.equal((await post('/api/cookies', { ownerToken: secret(), id: 'a'.repeat(64) })).status, 400);
      assert.equal((await post('/api/cookies', { ownerToken: secret(), rarity: 'mythic' })).status, 400);
    });

    await t.test('retrying issuance is idempotent, not another random roll', async () => {
      const { cookie, ownerToken } = await issue();
      const response = await post('/api/cookies', { ownerToken });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).cookie.id, cookie.id);
    });

    await t.test('public access cannot eat, and a wrong token cannot eat', async () => {
      const { cookie } = await issue();
      assert.equal((await post(`/api/cookies/${cookie.id}/bite`, { expectedBites: 0 })).status, 401);
      assert.equal((await post(`/api/cookies/${cookie.id}/bite`, { expectedBites: 0 }, secret())).status, 409);
      const response = await fetch(base + '/api/cookies/' + cookie.id);
      assert.equal((await response.json()).cookie.bites, 0);
    });

    await t.test('concurrent/retried bites apply once; 64 -> 42 -> 21 -> 0; record remains', async () => {
      const { cookie, ownerToken } = await issue();
      const endpoint = `/api/cookies/${cookie.id}/bite`;
      const concurrent = await Promise.all(Array.from({ length: 6 }, () => post(endpoint, { expectedBites: 0 }, ownerToken)));
      assert.equal(concurrent.filter(response => response.status === 200).length, 1);
      assert.equal(concurrent.filter(response => response.status === 409).length, 5);
      let state = (await (await fetch(base + '/api/cookies/' + cookie.id)).json()).cookie;
      assert.equal(state.remainingHash, cookie.id.slice(0, 42));
      for (const [expectedBites, remainingLength] of [[1, 21], [2, 0]]) {
        const response = await post(endpoint, { expectedBites }, ownerToken);
        assert.equal(response.status, 200);
        state = (await response.json()).cookie;
        assert.equal(state.remainingHash, cookie.id.slice(0, remainingLength));
      }
      assert.equal(state.status, 'eaten');
      assert.ok(state.eatenAt);
      assert.equal(state.id, cookie.id);
      assert.equal((await post(endpoint, { expectedBites: 2 }, ownerToken)).status, 409);
      const retried = await post('/api/cookies', { ownerToken });
      assert.equal((await retried.json()).cookie.bites, 3);
      const verify = await fetch(base + '/verify/' + cookie.id);
      assert.equal(verify.status, 200);
      assert.match(await verify.text(), /Eaten — no bites remaining/);
    });

    await t.test('different visitors receive distinct cookies', async () => {
      const first = await issue();
      const second = await issue();
      assert.notEqual(first.cookie.id, second.cookie.id);
    });

    await t.test('unknown and manipulated certificate IDs are not verified', async () => {
      assert.equal((await fetch(base + '/api/cookies/' + 'f'.repeat(64))).status, 404);
      assert.equal((await fetch(base + '/verify/' + 'f'.repeat(64))).status, 404);
      assert.equal((await fetch(base + '/api/cookies/' + 'f'.repeat(64) + '/certificate')).status, 404);
      assert.equal((await fetch(base + '/api/cookies/not-a-hash')).status, 400);
    });

    await t.test('certificate uses the trusted origin, QR code and server record', async () => {
      const { cookie, ownerToken } = await issue();
      const response = await fetch(base + `/api/cookies/${cookie.id}/certificate`, {
        headers: { 'X-Forwarded-Host': 'forged.example', Host: 'forged.example' }
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const html = await response.text();
      assert.match(html, /Cookie Certificate/);
      assert.ok(html.includes(`https://cookies.example/verify/${cookie.id}`));
      assert.ok(html.includes(cookie.createdAt));
      assert.match(html, /data:image\/png;base64,/);
      assert.match(html, /Print \/ Save as PDF/);
      assert.ok(!html.includes(ownerToken));
      assert.ok(!html.includes('forged.example'));
    });

    await t.test('CORS permits the configured frontend, not arbitrary sites', async () => {
      const allowed = await fetch(base + '/api/cookies', {
        method: 'OPTIONS', headers: { Origin: 'https://luca.github.io' }
      });
      assert.equal(allowed.status, 204);
      assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://luca.github.io');
      const denied = await fetch(base + '/api/cookies', {
        method: 'OPTIONS', headers: { Origin: 'https://other.example' }
      });
      assert.equal(denied.status, 403);
    });

    await t.test('real schema rejects a fourth bite and preserves the original hash', async () => {
      const { cookie } = await issue();
      await assert.rejects(db.execute({ sql: 'UPDATE cookies SET bites = 4 WHERE id = ?', args: [cookie.id] }));
      await assert.rejects(db.execute({ sql: 'UPDATE cookies SET id = ? WHERE id = ?', args: ['oops', cookie.id] }));
    });

    await t.test('rarity thresholds and the longest sequence include boundary-spanning runs', () => {
      const base = '0123456789abcdef'.repeat(4);
      const id = base.slice(0, 31) + 'aaa' + base.slice(34);
      assert.equal(id.length, 64);
      assert.equal(longestRun(id), 3);
      assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 64].map(streak => rarity(streak).name),
        ['common', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'mythic']);
    });

    await t.test('health and frontend assets are served by the same app', async () => {
      assert.equal((await fetch(base + '/health')).status, 200);
      const html = await (await fetch(base + '/')).text();
      assert.match(html, /apple-touch-icon\.png/);
      assert.match(html, /Certificate/);
      for (const asset of ['/app.js', '/style.css', '/certificate.css', '/certificate.js', '/zoom.js']) {
        assert.equal((await fetch(base + asset)).status, 200);
      }
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    db.close();
  }
});
