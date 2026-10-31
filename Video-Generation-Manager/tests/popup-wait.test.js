'use strict';
// 弹窗不要抢着关：先等 3–5 秒，用户手动点掉或自己消失后继续
const test = require('node:test');
const assert = require('node:assert/strict');
const { settlePopups, visiblePopup } = require('../src/automation');

function fakePage({ hideAfterMs = null, boxLess = false } = {}) {
  const shownAt = Date.now();
  const updates = [];
  const item = {
    async isVisible() {
      if (hideAfterMs === null) return true;
      return Date.now() - shownAt < hideAfterMs;
    },
    async boundingBox() { return boxLess ? { width: 20, height: 10 } : { width: 320, height: 220 }; },
  };
  return {
    updates,
    async bringToFront() { updates.push('front'); },
    locator() {
      return {
        async count() { return 1; },
        nth() { return item; },
      };
    },
  };
}

test('弹窗自己消失：静静等它，不弹提示', async () => {
  const page = fakePage({ hideAfterMs: 700 });
  const updates = [];
  const ok = await settlePopups(page, { signal: new AbortController().signal, update: (v) => updates.push(v), graceMs: 3000, maxWaitMs: 5000 });
  assert.equal(ok, true);
  assert.deepEqual(updates, [], '还没到宽限期就不打扰用户');
});

test('弹窗超过宽限期：把窗口提到前面并提示用户点掉', async () => {
  const page = fakePage({ hideAfterMs: 1200 });
  const updates = [];
  const ok = await settlePopups(page, { signal: new AbortController().signal, update: (v) => updates.push(v), graceMs: 300, maxWaitMs: 5000, label: '登录提示' });
  assert.equal(ok, true);
  const paused = updates.find((u) => u && u.status === 'paused');
  assert.ok(paused, '应该进入等待并提示');
  assert.match(paused.message, /登录提示/);
  assert.ok(page.updates.includes('front'), '要把窗口提到最前，方便用户点掉');
});

test('一直不消失：等满上限后返回 false，而不是直接关窗口', async () => {
  const page = fakePage();
  const ok = await settlePopups(page, { signal: new AbortController().signal, graceMs: 100, maxWaitMs: 600 });
  assert.equal(ok, false);
});

test('没有弹窗时立刻返回', async () => {
  const page = { locator() { return { async count() { return 0; }, nth() { throw new Error('不该取元素'); } }; } };
  assert.equal(await visiblePopup(page), null);
  const ok = await settlePopups(page, { signal: new AbortController().signal, graceMs: 100, maxWaitMs: 500 });
  assert.equal(ok, true);
});

test('太小的浮层不算阻断弹窗（比如气泡、提示条）', async () => {
  const page = fakePage({ hideAfterMs: null, boxLess: true });
  const ok = await settlePopups(page, { signal: new AbortController().signal, graceMs: 100, maxWaitMs: 400 });
  assert.equal(ok, true);
});
