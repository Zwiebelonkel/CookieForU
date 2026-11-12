import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('certificate printing downloads one Owner Pass per print dialog, including browser printing', () => {
  const events = new Map<string, () => void>();
  let click!: () => void;
  const actions: string[] = [];
  const window = {
    downloadCookieOwnerPass: () => { actions.push('download'); },
    addEventListener: (name: string, fn: () => void) => events.set(name, fn),
    print: () => {
      actions.push('print');
      events.get('beforeprint')!();
      events.get('afterprint')!();
    },
  };
  runInNewContext(readFileSync(new URL('../public/certificate.js', import.meta.url), 'utf8'), {
    window,
    document: { getElementById: (id: string) => id === 'print' ? {
      addEventListener: (_name: string, fn: () => void) => { click = fn; },
    } : null },
  });
  click();
  assert.deepEqual(actions, ['download', 'print']);
  click();
  assert.deepEqual(actions, ['download', 'print', 'download', 'print']);
  events.get('beforeprint')!();
  events.get('afterprint')!();
  events.get('beforeprint')!();
  events.get('afterprint')!();
  assert.deepEqual(actions, ['download', 'print', 'download', 'print', 'download', 'download']);
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
    window, Blob,
    URL: { createObjectURL: (value: Blob) => { blob = value; return 'blob:owner-pass'; } },
    setTimeout: () => {},
  });
  const id = 'a'.repeat(64), token = 'b'.repeat(64), origin = 'https://cookies.example';
  window.CookieOwnership.downloadPass(origin, id, token, targetWindow);
  const pass = window.CookieOwnership.parsePass(await blob.text(), origin);
  assert.equal(pass.cookieId, id);
  assert.equal(pass.ownerToken, token);
  assert.equal(filename, `cookie-${id}-PRIVATE-owner-pass.json`);
});
