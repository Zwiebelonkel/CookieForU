import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { createClient } from '@libsql/client';
import { createApp } from '../src/app.js';
import { tokenHash } from '../src/cookies.js';

test('Owner Pass restoration and independent, expiring ownership checks', async t => {
  const db = createClient({ url: ':memory:' });
  const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  await db.executeMultiple(schema);
  const config = { publicBaseUrl: 'https://cookies.example', corsOrigin: 'https://frontend.example', rateLimits: false };
  const servers: ReturnType<ReturnType<typeof createApp>['listen']>[] = [];
  async function listen(rateLimits = false) {
    const server = createApp(db, { ...config, rateLimits }).listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    return `http://127.0.0.1:${address.port}`;
  }
  const base = await listen();
  const sessionToken = (await (await fetch(base + '/api/session', { method: 'POST' })).json()).sessionToken;
  const secret = () => randomBytes(32).toString('hex');
  const post = (path: string, body: object = {}, token?: string, host = base) => fetch(host + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Cookie-Session': sessionToken, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body)
  });
  const get = (path: string, token?: string, host = base) => fetch(host + path, {
    headers: token ? { Authorization: 'Bearer ' + token } : {}
  });
  async function issue() {
    const token = secret();
    const response = await post('/api/cookies', { ownerToken: token });
    assert.equal(response.status, 201);
    return { cookie: (await response.json()).cookie, token };
  }
  const owner = await issue(), other = await issue();
  const endpoint = `/api/cookies/${owner.cookie.id}/owner-checks`;
  async function start() {
    const response = await post(endpoint);
    assert.equal(response.status, 201);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  }
  async function age(code: string) {
    await db.execute({
      sql: `UPDATE owner_checks SET created_at = created_at - 300001, expires_at = expires_at - 300001,
        confirmed_at = CASE WHEN confirmed_at IS NULL THEN NULL ELSE confirmed_at - 300001 END WHERE code = ?`,
      args: [code]
    });
  }

  try {
    await t.test('existing cookies survive idempotent schema upgrades', async () => {
      await db.executeMultiple(schema);
      assert.equal((await (await get(`/api/cookies/${owner.cookie.id}`)).json()).cookie.id, owner.cookie.id);
    });

    await t.test('an Owner Pass is validated against its cookie before restoration', async () => {
      const path = `/api/cookies/${owner.cookie.id}/owner`;
      assert.equal((await get(path)).status, 401);
      assert.equal((await get(path, secret())).status, 403);
      assert.equal((await get(path, other.token)).status, 403);
      const response = await get(path, owner.token);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(JSON.parse(text).cookie.id, owner.cookie.id);
      assert.ok(!text.includes(owner.token));
      assert.ok(!text.includes(tokenHash(owner.token)));
      assert.equal((await db.execute('SELECT count(*) AS count FROM cookies')).rows[0].count, 2);
    });

    await t.test('a fresh verifier gets a private read token; the public record gets no credentials', async () => {
      const data = await start();
      assert.match(data.check.code, /^[0-9a-f]{16}$/);
      assert.match(data.verifierToken, /^[0-9a-f]{64}$/);
      assert.equal(data.check.cookieId, owner.cookie.id);
      assert.equal(data.check.status, 'pending');
      assert.equal(data.check.confirmedAt, null);
      assert.ok(data.check.remainingMs > 0 && data.check.remainingMs <= 300_000);
      const stored = (await db.execute({ sql: 'SELECT * FROM owner_checks WHERE code = ?', args: [data.check.code] })).rows[0];
      assert.equal(stored.verifier_token_hash, tokenHash(data.verifierToken));
      for (const path of [`/api/cookies/${owner.cookie.id}`, `/verify/${owner.cookie.id}`]) {
        const text = await (await get(path)).text();
        for (const sensitive of [owner.token, data.verifierToken, data.check.code, String(stored.verifier_token_hash)]) {
          assert.ok(!text.includes(sensitive));
        }
      }
      const path = endpoint + '/' + data.check.code;
      assert.equal((await get(path)).status, 401);
      assert.equal((await get(path + '?verifierToken=' + data.verifierToken)).status, 401);
      assert.equal((await get(path, owner.token)).status, 404);
      const response = await get(path, data.verifierToken);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.ok(!(await response.text()).includes(data.verifierToken));
    });

    await t.test('only the matching owner can confirm; the code alone grants no control', async () => {
      const { check, verifierToken } = await start();
      const path = endpoint + '/' + check.code;
      for (const [token, expected] of [[undefined, 401], [secret(), 403], [other.token, 403], [verifierToken, 403]] as const) {
        assert.equal((await post(path + '/confirm', {}, token)).status, expected);
      }
      const wrongCookie = `/api/cookies/${other.cookie.id}/owner-checks/${check.code}/confirm`;
      assert.equal((await post(wrongCookie, {}, other.token)).status, 404);
      assert.equal((await (await get(path, verifierToken)).json()).check.status, 'pending');
      const confirmed = await post(path + '/confirm', {}, owner.token);
      assert.equal(confirmed.status, 200);
      const text = await confirmed.text();
      assert.ok(!text.includes(owner.token));
      assert.ok(!text.includes(verifierToken));
      assert.equal((await (await get(path, verifierToken)).json()).check.status, 'confirmed');
      assert.equal((await (await get(`/api/cookies/${owner.cookie.id}`)).json()).cookie.bites, 0);
    });

    await t.test('confirmation cannot be replayed or applied to another verification session', async () => {
      const first = await start(), second = await start();
      const firstPath = endpoint + '/' + first.check.code;
      const secondPath = endpoint + '/' + second.check.code;
      const responses = await Promise.all(Array.from({ length: 6 }, () => post(firstPath + '/confirm', {}, owner.token)));
      assert.equal(responses.filter(response => response.status === 200).length, 1);
      assert.equal(responses.filter(response => response.status === 409).length, 5);
      assert.equal((await get(firstPath, second.verifierToken)).status, 404);
      assert.equal((await get(secondPath, first.verifierToken)).status, 404);
      assert.equal((await (await get(secondPath, second.verifierToken)).json()).check.status, 'pending');
      const restartBase = await listen();
      assert.equal((await (await get(firstPath, first.verifierToken, restartBase)).json()).check.status, 'confirmed');
      const publicRecord = await (await get(`/api/cookies/${owner.cookie.id}`)).text();
      assert.ok(!publicRecord.includes('confirmedAt'));
    });

    await t.test('expired checks reject confirmation and cease to be valid even after success', async () => {
      for (const confirmFirst of [false, true]) {
        const data = await start();
        const path = endpoint + '/' + data.check.code;
        if (confirmFirst) assert.equal((await post(path + '/confirm', {}, owner.token)).status, 200);
        await age(data.check.code);
        assert.equal((await post(path + '/confirm', {}, owner.token)).status, 410);
        const expired = (await (await get(path, data.verifierToken)).json()).check;
        assert.equal(expired.status, 'expired');
        assert.equal(expired.remainingMs, 0);
      }
    });

    await t.test('unknown cookies and client-selected codes or confirmations are rejected', async () => {
      assert.equal((await post('/api/cookies/' + 'f'.repeat(64) + '/owner-checks')).status, 404);
      assert.equal((await post(endpoint, { code: 'a'.repeat(16), status: 'confirmed' })).status, 400);
      const data = await start();
      assert.equal((await post(endpoint + '/' + data.check.code + '/confirm', { confirmedAt: 'now' }, owner.token)).status, 400);
      assert.equal((await post(endpoint + '/invalid/confirm', {}, owner.token)).status, 400);
      const denied = await fetch(base + endpoint, { method: 'POST', headers: { Origin: 'https://forged.example' } });
      assert.equal(denied.status, 403);
      const allowed = await fetch(base + endpoint, {
        method: 'OPTIONS', headers: { Origin: 'https://frontend.example', 'Access-Control-Request-Headers': 'authorization' }
      });
      assert.equal(allowed.status, 204);
      assert.match(allowed.headers.get('access-control-allow-headers') ?? '', /Authorization/);
    });

    await t.test('starting public checks is rate limited separately', async () => {
      const limitedBase = await listen(true);
      for (let i = 0; i < 10; i++) assert.equal((await post(endpoint, {}, undefined, limitedBase)).status, 201);
      const response = await post(endpoint, {}, undefined, limitedBase);
      assert.equal(response.status, 429);
      assert.ok(response.headers.get('retry-after'));
      assert.equal((await post(endpoint + '/', {}, undefined, limitedBase)).status, 429);
      assert.equal((await post(endpoint.replace('owner-checks', 'OWNER-CHECKS'), {}, undefined, limitedBase)).status, 429);
      assert.equal((await get(`/api/cookies/${owner.cookie.id}`, undefined, limitedBase)).status, 200);
    });

    await t.test('downloaded passes restore existing and eaten cookies without issuing new ones', async () => {
      const window: any = {};
      runInNewContext(await readFile(new URL('../public/ownership.js', import.meta.url), 'utf8'), { window, fetch, AbortSignal, crypto: globalThis.crypto });
      const helpers = window.CookieOwnership;
      const text = helpers.makePass(base, owner.cookie.id, owner.token);
      const pass = helpers.parsePass(text, base);
      assert.equal(pass.ownerToken, owner.token);
      assert.equal((await helpers.loadOwner(base, pass.cookieId, pass.ownerToken)).id, owner.cookie.id);
      for (let expectedBites = 0; expectedBites < 3; expectedBites++) {
        assert.equal((await post(`/api/cookies/${owner.cookie.id}/bite`, { expectedBites }, owner.token)).status, 200);
      }
      assert.equal((await helpers.loadOwner(base, pass.cookieId, pass.ownerToken)).status, 'eaten');
      const check = await start();
      await helpers.confirm(base, pass.cookieId, pass.ownerToken, helpers.formatCode(check.check.code));
      assert.equal((await (await get(endpoint + '/' + check.check.code, check.verifierToken)).json()).check.status, 'confirmed');
      await assert.rejects(helpers.loadOwner(base, pass.cookieId, other.token));
      assert.throws(() => helpers.parsePass(text, 'https://attacker.example'), /different cookie service/);
      assert.throws(() => helpers.parsePass('{', base), /valid Cookie Owner Pass/);
      assert.throws(() => helpers.parsePass(JSON.stringify({ ...pass, ownerToken: 'invalid' }), base), /not a valid/);
      assert.equal((await db.execute('SELECT count(*) AS count FROM cookies')).rows[0].count, 2);
    });
  } finally {
    await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
    db.close();
  }
});
