import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('certificate printing does not download another Owner Pass', () => {
  const events = new Map<string, () => void>();
  let click!: () => void;
  const actions: string[] = [];
  const window = {
    downloadCookieOwnerPass: () => { actions.push('download'); },
    addEventListener: (name: string, fn: () => void) => events.set(name, fn),
    print: () => {
      actions.push('print');
      events.get('beforeprint')?.();
      events.get('afterprint')?.();
    },
  };
  runInNewContext(readFileSync(new URL('../public/certificate.js', import.meta.url), 'utf8'), {
    window,
    document: { getElementById: (id: string) => id === 'print' ? {
      addEventListener: (_name: string, fn: () => void) => { click = fn; },
    } : null },
  });
  click();
  assert.deepEqual(actions, ['print']);
  click();
  assert.deepEqual(actions, ['print', 'print']);
  assert.equal(events.size, 0);
});

test('Certificate click downloads the key immediately before the certificate request finishes', async () => {
  const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('  certificate.addEventListener("click",');
  const end = source.indexOf('  document.addEventListener("pointerdown",', start);
  let click!: () => Promise<void>;
  const actions: unknown[] = [];
  const id = 'a'.repeat(64), token = 'b'.repeat(64);
  const certificateWindow = { document: {
    title: '', body: { textContent: '' }, open() {}, write() {}, close() {},
  }, opener: null, closed: false, close() {} };
  let finish!: (value: unknown) => void;
  runInNewContext(source.slice(start, end), {
    certificate: { addEventListener: (_event: string, fn: () => Promise<void>) => { click = fn; } },
    cookie: { id }, ownerToken: token, busy: false, deliveryPending: false, generation: 0,
    apiBase: 'https://cookies.example', status: { textContent: '' }, render() {}, AbortSignal,
    window: { open: () => certificateWindow },
    ownership: { downloadPass: (...args: unknown[]) => actions.push(args) },
    fetch: () => new Promise(resolve => { finish = resolve; }),
  });
  const pending = click();
  assert.deepEqual(actions, [['https://cookies.example', id, token]]);
  finish({ ok: true, text: async () => '<html></html>' });
  await pending;
  assert.equal(actions.length, 1);
});

test('downloaded key is an importable Owner Pass for the exact certificate cookie', async () => {
  let blob!: Blob;
  let filename = '';
  const targetWindow = { document: {
    createElement: () => ({ href: '', download: '', click() { filename = this.download; }, remove() {} }),
    body: { append() {} },
  } };
  const window: any = {};
  runInNewContext(readFileSync(new URL('../public/ownership.js', import.meta.url), 'utf8'), {
    window, Blob, crypto: globalThis.crypto,
    URL: { createObjectURL: (value: Blob) => { blob = value; return 'blob:owner-pass'; } },
    setTimeout: () => {},
  });
  const id = 'a'.repeat(64), token = 'b'.repeat(64), origin = 'https://cookies.example';
  window.CookieOwnership.downloadPass(origin, id, token, targetWindow);
  const pass = window.CookieOwnership.parsePass(await blob.text(), origin);
  assert.equal(pass.cookieId, id);
  assert.equal(pass.ownerToken, token);
  assert.match(pass.ownerPassId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(filename, `cookie-${id}-PRIVATE-owner-pass-${pass.ownerPassId}.json`);
  const secondPass = JSON.parse(window.CookieOwnership.makePass(origin, id, token));
  assert.notEqual(secondPass.ownerPassId, pass.ownerPassId);
});
