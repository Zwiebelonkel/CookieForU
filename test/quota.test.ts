import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@libsql/client';
import { createApp } from '../src/app.js';
import { tokenHash, COOKIE_WINDOW_MS } from '../src/cookies.js';

test('server enforces ten new cookies per browser session in a rolling ten-minute window', async t => {
  const db = createClient({ url: ':memory:' });
  const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  await db.executeMultiple(schema);
  const servers: ReturnType<ReturnType<typeof createApp>['listen']>[] = [];
  const listen = async () => {
    const server = createApp(db, { publicBaseUrl: 'https://cookies.example', corsOrigin: 'https://frontend.example', rateLimits: false }).listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return `http://127.0.0.1:${address.port}`;
  };
  const base = await listen();
  const secret = () => randomBytes(32).toString('hex');
  const session = async () => {
    const response = await fetch(base + '/api/session', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
    assert.equal(response.status, 201);
    const { sessionToken } = await response.json();
    assert.match(sessionToken, /^[0-9a-f]{64}$/);
    return sessionToken as string;
  };
  const issue = (sessionToken?: string, ownerToken = secret(), server = base) => fetch(server + '/api/cookies', {
    method: 'POST', body: JSON.stringify({ ownerToken }),
    headers: { 'Content-Type': 'application/json', ...(sessionToken ? { 'X-Cookie-Session': sessionToken } : {}) },
  });
  try {
    await t.test('missing, malformed and invented sessions cannot receive cookies', async () => {
      for (const token of [undefined, 'bad', secret()]) assert.equal((await issue(token)).status, 401);
      assert.equal((await db.execute('SELECT count(*) AS total FROM cookies')).rows[0].total, 0);
    });

    const sharedSession = await session();
    const ownerToken = secret();
    let cookieId: string;
    await t.test('parallel retries for one owner count exactly once', async () => {
      const responses = await Promise.all(Array.from({ length: 5 }, () => issue(sharedSession, ownerToken)));
      assert.equal(responses.filter(response => response.status === 201).length, 1);
      assert.equal(responses.filter(response => response.status === 200).length, 4);
      const cookies = await Promise.all(responses.map(async response => (await response.json()).cookie));
      assert.equal(new Set(cookies.map(cookie => cookie.id)).size, 1);
      cookieId = cookies[0].id;
      assert.equal((await db.execute('SELECT count(*) AS total FROM cookie_issuances')).rows[0].total, 1);
    });

    await t.test('parallel requests cannot exceed the ten-cookie allowance', async () => {
      const responses = await Promise.all(Array.from({ length: 15 }, () => issue(sharedSession)));
      assert.equal(responses.filter(response => response.status === 201).length, 9);
      assert.equal(responses.filter(response => response.status === 429).length, 6);
      const limited = responses.find(response => response.status === 429)!;
      const body = await limited.json();
      assert.equal(body.code, 'quota_exhausted');
      assert.equal(body.error, 'Cookies are getting baked.');
      assert.ok(body.retryAfterMs > 0 && body.retryAfterMs <= COOKIE_WINDOW_MS);
      assert.equal(Number(limited.headers.get('retry-after')), Math.ceil(body.retryAfterMs / 1000));
      assert.equal(body.cookie, undefined);
      assert.equal((await db.execute('SELECT count(*) AS total FROM cookie_issuances')).rows[0].total, 10);
    });

    await t.test('full sessions can retry, restore, eat and print existing cookies', async () => {
      const response = await issue(sharedSession, ownerToken);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).cookie.id, cookieId!);
      const headers = { Authorization: 'Bearer ' + ownerToken };
      assert.equal((await fetch(base + `/api/cookies/${cookieId!}/owner`, { headers })).status, 200);
      assert.equal((await fetch(base + `/api/cookies/${cookieId!}/certificate`, { headers })).status, 200);
      const bite = await fetch(base + `/api/cookies/${cookieId!}/bite`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{"expectedBites":0}',
      });
      assert.equal(bite.status, 200);
      assert.equal((await db.execute('SELECT count(*) AS total FROM cookie_issuances')).rows[0].total, 10);
    });

    await t.test('another session on the same IP has its own allowance', async () => {
      assert.equal((await issue(await session())).status, 201);
      assert.equal((await issue(sharedSession)).status, 429);
    });

    await t.test('restarting the app and rerunning the schema do not reset usage', async () => {
      await db.executeMultiple(schema);
      assert.equal((await issue(sharedSession, secret(), await listen())).status, 429);
    });

    await t.test('an expired issuance frees exactly one place instead of resetting the entire batch', async () => {
      await db.execute({ sql: 'UPDATE cookie_issuances SET issued_at = ? WHERE cookie_id = ?', args: [Date.now() - COOKIE_WINDOW_MS, cookieId!] });
      assert.equal((await issue(sharedSession)).status, 201);
      assert.equal((await issue(sharedSession)).status, 429);
      await db.execute({ sql: 'UPDATE cookie_issuances SET issued_at = ? WHERE session_hash = ?', args: [Date.now() - COOKIE_WINDOW_MS, tokenHash(sharedSession)] });
      assert.equal((await issue(sharedSession)).status, 201);
    });

    await t.test('separate frontends may send session headers through CORS', async () => {
      const response = await fetch(base + '/api/cookies', {
        method: 'OPTIONS', headers: { Origin: 'https://frontend.example', 'Access-Control-Request-Headers': 'x-cookie-session' },
      });
      assert.equal(response.status, 204);
      assert.match(response.headers.get('access-control-allow-headers')!, /X-Cookie-Session/);
    });
  } finally {
    await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    db.close();
  }
});
