import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const document = new EventTarget();
runInNewContext(readFileSync(new URL('../public/zoom.js', import.meta.url), 'utf8'), { document });

function prevented(type: string, properties = {}) {
  const event = Object.assign(new Event(type, { cancelable: true }), properties);
  document.dispatchEvent(event);
  return event.defaultPrevented;
}

test('blocks zoom shortcuts but keeps printing, copying and ordinary keys available', () => {
  for (const modifier of ['ctrlKey', 'metaKey']) {
    for (const key of ['+', '=', '-', '_', '0']) {
      assert.equal(prevented('keydown', { [modifier]: true, key }), true);
    }
    for (const code of ['NumpadAdd', 'NumpadSubtract', 'Numpad0']) {
      assert.equal(prevented('keydown', { [modifier]: true, code }), true);
    }
    for (const key of ['p', 'c']) {
      assert.equal(prevented('keydown', { [modifier]: true, key }), false);
    }
  }
  assert.equal(prevented('keydown', { key: '+' }), false);
});

test('blocks modified wheel zoom while preserving normal scrolling', () => {
  assert.equal(prevented('wheel', { ctrlKey: true }), true);
  assert.equal(prevented('wheel', { metaKey: true }), true);
  assert.equal(prevented('wheel'), false);
});

test('blocks pinch gestures while preserving single-finger touch and taps', () => {
  for (const type of ['touchstart', 'touchmove']) {
    assert.equal(prevented(type, { touches: [{}, {}] }), true);
    assert.equal(prevented(type, { touches: [{}] }), false);
  }
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    assert.equal(prevented(type), true);
  }
  assert.equal(prevented('click'), false);
});
