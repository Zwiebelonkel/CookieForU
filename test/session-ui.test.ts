import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('tabs and reloads reuse one browser session and first-time tabs share initialization', async () => {
  const storage = new Map<string, string>();
  let queue = Promise.resolve(), requests = 0;
  const source = readFileSync(new URL('../public/session.js', import.meta.url), 'utf8');
  const loadTab = () => {
    const window: any = {};
    runInNewContext(source, {
      window, AbortSignal,
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
        removeItem: (key: string) => storage.delete(key),
      },
      navigator: { locks: { request: (_key: string, callback: () => Promise<unknown>) => {
        const next = queue.then(callback);
        queue = next.then(() => {}, () => {});
        return next;
      } } },
      fetch: async () => { requests++; return { ok: true, json: async () => ({ sessionToken: 'a'.repeat(64) }) }; },
    });
    return window.CookieSession;
  };
  const first = loadTab(), second = loadTab();
  const origin = 'https://cookies.example';
  const tokens = await Promise.all([first.getToken(origin), first.getToken(origin), second.getToken(origin)]);
  assert.equal(requests, 1);
  assert.ok(tokens.every(token => token === 'a'.repeat(64)));
  assert.equal(await loadTab().getToken(origin), tokens[0]);
  assert.equal(requests, 1);
});

test('baking countdown uses elapsed time and retries only once it expires', () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('  function checkDelivery()');
  const end = source.indexOf('  retry.addEventListener', start);
  const timer = { textContent: '' };
  let now = 0, starts = 0, refreshes = 0;
  const context = {
    document: { hidden: false }, busy: false, refreshing: false, cookie: null,
    bakingDeadline: 600_000, deliveryPending: false,
    performance: { now: () => now }, $: () => timer,
    initialize: () => { starts++; context.busy = true; },
    refresh: () => { refreshes++; },
  };
  runInNewContext(source.slice(start, end) + '\nthis.tick = tickBaking; this.check = checkDelivery;', context);
  const ui = context as typeof context & { tick(): void; check(): void };
  ui.tick();
  assert.equal(timer.textContent, '10:00');
  now = 125_000;
  ui.tick();
  assert.equal(timer.textContent, '7:55');
  for (let i = 0; i < 10; i++) ui.check();
  assert.equal(starts, 0);
  assert.equal(refreshes, 0);
  now = 600_000;
  ui.document.hidden = true;
  ui.tick();
  assert.equal(timer.textContent, '0:00');
  assert.equal(starts, 0);
  ui.document.hidden = false;
  ui.check();
  ui.tick();
  assert.equal(starts, 1);
});
