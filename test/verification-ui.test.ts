import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

class Element {
  dataset: Record<string, string> = {};
  textContent = '';
  hidden = false;
  disabled = false;
  listeners = new Map<string, () => unknown>();
  addEventListener(type: string, callback: () => unknown) { this.listeners.set(type, callback); }
  async fire(type: string) { await this.listeners.get(type)?.(); }
}

function verificationUI() {
  const ids = ['owner-check', 'start-owner-check', 'check-details', 'check-code', 'check-time', 'check-result'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  elements['owner-check'].dataset = { apiOrigin: 'https://cookies.example', cookieId: 'a'.repeat(64) };
  const timers = new Map<number, () => unknown>(), intervals = new Map<number, () => unknown>();
  const document = Object.assign(new Element(), { hidden: false, getElementById: (id: string) => elements[id] });
  const requests: { path: string; options: any }[] = [];
  const replies: (() => unknown)[] = [];
  let time = 0, timerId = 0;
  const window = Object.assign(new Element(), {
    CookieOwnership: {
      formatCode: (code: string) => code.toUpperCase(),
      apiJson: async (_origin: string, path: string, options: any) => {
        requests.push({ path, options });
        const reply = replies.shift();
        if (!reply) throw new Error('No response queued');
        return await reply();
      }
    }
  });
  runInNewContext(readFileSync(new URL('../public/certificate.js', import.meta.url), 'utf8'), {
    document, window, performance: { now: () => time },
    setTimeout: (fn: () => unknown) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: (fn: () => unknown) => { intervals.set(++timerId, fn); return timerId; },
    clearInterval: (id: number) => intervals.delete(id)
  });
  const check = (status = 'pending', code = '1'.repeat(16)) => ({
    cookieId: 'a'.repeat(64), code, remainingMs: 300_000 - time, status,
    confirmedAt: status === 'confirmed' ? '2026-11-12T12:00:00.000Z' : null
  });
  return {
    elements, document, window, requests, replies, check,
    start: async (code = '1'.repeat(16)) => {
      replies.push(() => ({ check: check('pending', code), verifierToken: 'b'.repeat(64) }));
      await elements['start-owner-check'].fire('click');
    },
    poll: async () => {
      const next = timers.entries().next().value;
      assert.ok(next);
      timers.delete(next[0]);
      await next[1]();
    },
    advance: (ms: number) => { time += ms; for (const fn of intervals.values()) fn(); }
  };
}

test('verification UI shows only current server confirmation and expires it locally', async () => {
  const ui = verificationUI();
  await ui.start();
  const result = ui.elements['check-result'];
  assert.equal(result.dataset.state, 'pending');
  assert.equal(ui.elements['check-details'].hidden, false);
  ui.replies.push(() => ({ check: ui.check('confirmed') }));
  await ui.poll();
  assert.equal(result.dataset.state, 'confirmed');
  assert.match(result.textContent, /Control of this cookie/);
  const poll = ui.requests.at(-1)!;
  assert.equal(poll.options.headers.Authorization, 'Bearer ' + 'b'.repeat(64));
  assert.ok(!poll.path.includes('b'.repeat(64)));
  ui.advance(300_001);
  assert.equal(result.dataset.state, 'expired');
  assert.doesNotMatch(result.textContent, /Owner confirmed/);
});

test('network failure removes a successful state and recovery requires another server response', async () => {
  const ui = verificationUI();
  await ui.start();
  ui.replies.push(() => ({ check: ui.check('confirmed') }));
  await ui.poll();
  ui.replies.push(() => { throw new Error('offline'); });
  await ui.poll();
  assert.equal(ui.elements['check-result'].dataset.state, 'unavailable');
  assert.doesNotMatch(ui.elements['check-result'].textContent, /Owner confirmed/);
  ui.replies.push(() => ({ check: ui.check('confirmed') }));
  await ui.poll();
  assert.equal(ui.elements['check-result'].dataset.state, 'confirmed');
});

test('a delayed response to an old check cannot confirm a new check', async () => {
  const ui = verificationUI();
  await ui.start();
  let resolveOld!: (reply: object) => void;
  ui.replies.push(() => new Promise(resolve => { resolveOld = resolve; }));
  const pending = ui.poll();
  await ui.start('2'.repeat(16));
  resolveOld({ check: ui.check('confirmed') });
  await pending;
  assert.equal(ui.elements['check-code'].textContent, '2'.repeat(16));
  assert.equal(ui.elements['check-result'].dataset.state, 'pending');
});

test('returning to a saved page requires a fresh check', async () => {
  const ui = verificationUI();
  await ui.start();
  ui.replies.push(() => ({ check: ui.check('confirmed') }));
  await ui.poll();
  await ui.window.fire('pagehide');
  assert.equal(ui.elements['check-details'].hidden, true);
  assert.equal(ui.elements['check-result'].dataset.state, 'idle');
  assert.doesNotMatch(ui.elements['check-result'].textContent, /Owner confirmed/);
});
