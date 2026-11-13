import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../public/leaderboard.js', import.meta.url), 'utf8');

class Element extends EventTarget {
  children: Element[] = [];
  attributes = new Map<string, string>();
  dataset: Record<string, string> = {};
  textContent = '';
  className = '';
  href = '';
  title = '';
  hidden = false;
  open = false;
  fragment = false;
  focused = false;
  append(...elements: Element[]) {
    for (const element of elements) this.children.push(...(element.fragment ? element.children : [element]));
  }
  replaceChildren(...elements: Element[]) { this.children = []; this.append(...elements); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  hasAttribute(name: string) { return this.attributes.has(name); }
  removeAttribute(name: string) { this.attributes.delete(name); }
  toggleAttribute(name: string, force: boolean) { if (force) this.setAttribute(name, ''); else this.removeAttribute(name); }
  querySelector() { return this.children[0]; }
  contains(target: Element): boolean { return this === target || this.children.some(child => child.contains(target)); }
  focus() { this.focused = true; }
  click() { this.dispatchEvent(new Event('click', { cancelable: true })); }
}

function setup(request: () => Promise<unknown>) {
  const ids = ['leaderboard-menu', 'leaderboard-panel', 'leaderboard-list', 'leaderboard-status', 'retry-leaderboard'];
  const elements = new Map(ids.map(id => [id, new Element()]));
  const menu = elements.get('leaderboard-menu')!;
  const summary = new Element();
  menu.append(summary);
  const document = Object.assign(new EventTarget(), {
    getElementById: (id: string) => elements.get(id),
    querySelector: () => ({ content: 'https://cookies.example' }),
    createElement: () => new Element(),
    createDocumentFragment: () => Object.assign(new Element(), { fragment: true }),
  });
  let now = 0, requests = 0;
  runInNewContext(source, {
    document, URL, Event, performance: { now: () => now },
    window: {
      matchMedia: () => ({ matches: true }),
      CookieOwnership: { apiJson: async (origin: string, path: string) => {
        assert.equal(origin, 'https://cookies.example');
        assert.equal(path, '/api/leaderboard');
        requests++;
        return request();
      } }
    }
  });
  return {
    menu, summary, document, elements,
    get requests() { return requests; },
    setTime(value: number) { now = value; },
    async settle() { await new Promise(resolve => setImmediate(resolve)); }
  };
}

const cookie = { id: 'a'.repeat(64), rank: 1, rarity: 'mythic', stars: 6, maxStreak: 64, createdAt: '2026-01-01T00:00:00.000Z' };

test('leaderboard loads only when opened and reuses exactly the remaining server cache lifetime', async () => {
  const ui = setup(async () => ({ cookies: [cookie], refreshAfterMs: 1_500 }));
  assert.equal(ui.requests, 0);
  ui.summary.click();
  await ui.settle();
  assert.equal(ui.requests, 1);
  assert.equal(ui.menu.open, true);
  assert.equal(ui.elements.get('leaderboard-list')!.children.length, 1);
  const link = ui.elements.get('leaderboard-list')!.children[0].children[0];
  assert.equal(link.href, 'https://cookies.example/?cookie=' + cookie.id);
  assert.equal(ui.summary.attributes.get('aria-expanded'), 'true');
  ui.summary.click();
  ui.setTime(1_499);
  ui.summary.click();
  await ui.settle();
  assert.equal(ui.requests, 1);
  ui.summary.click();
  ui.setTime(1_500);
  ui.summary.click();
  await ui.settle();
  assert.equal(ui.requests, 2);
});

test('opening repeatedly during a slow load sends only one request; Escape and outside clicks close the menu', async () => {
  let resolve!: (value: unknown) => void;
  const ui = setup(() => new Promise(done => { resolve = done; }));
  ui.summary.click();
  ui.summary.click();
  ui.summary.click();
  assert.equal(ui.requests, 1);
  assert.equal(ui.elements.get('leaderboard-panel')!.attributes.get('aria-busy'), 'true');
  resolve({ cookies: [], refreshAfterMs: 30_000 });
  await ui.settle();
  assert.match(ui.elements.get('leaderboard-status')!.textContent, /No cookies drawn yet/);
  assert.equal(ui.elements.get('leaderboard-panel')!.attributes.get('aria-busy'), 'false');
  ui.document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
  assert.equal(ui.menu.open, false);
  assert.equal(ui.summary.focused, true);
  assert.equal(ui.summary.attributes.get('aria-expanded'), 'false');
  ui.summary.click();
  ui.document.dispatchEvent(new Event('pointerdown'));
  assert.equal(ui.menu.open, false);
  assert.equal(ui.requests, 1);
});

test('a failed refresh clears outdated results, shows retry, and can recover', async () => {
  let fail = false;
  const ui = setup(async () => {
    if (fail) throw new Error('offline');
    return { cookies: [cookie], refreshAfterMs: 30_000 };
  });
  ui.summary.click();
  await ui.settle();
  fail = true;
  ui.setTime(30_000);
  ui.summary.click();
  ui.summary.click();
  await ui.settle();
  assert.equal(ui.elements.get('leaderboard-list')!.children.length, 0);
  assert.equal(ui.elements.get('retry-leaderboard')!.hidden, false);
  assert.match(ui.elements.get('leaderboard-status')!.textContent, /unavailable/);
  fail = false;
  ui.elements.get('retry-leaderboard')!.click();
  await ui.settle();
  assert.equal(ui.requests, 3);
  assert.equal(ui.elements.get('leaderboard-list')!.children.length, 1);
  assert.equal(ui.elements.get('retry-leaderboard')!.hidden, true);
  assert.equal(ui.elements.get('leaderboard-status')!.textContent, '');
});
