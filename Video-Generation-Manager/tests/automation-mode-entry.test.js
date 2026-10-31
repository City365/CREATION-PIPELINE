'use strict';
// 视频入口：点了要真的进视频模式才算成功；「更多技能」用宽松匹配
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyOptions } = require('../src/automation');

// mode: 'direct' = 入口直接露在页面上；'more' = 只能从「更多技能」里找到；'none' = 两处都没有
function fakePage({ mode = 'direct', configuredWorks = false } = {}) {
  const calls = [];
  let videoMode = false;
  const worksFor = (text) => {
    if (text === 'configured') return configuredWorks;
    if (text === '更多技能 ›') return false;           // 只是打开菜单，不算进视频模式
    if (text === '视频生成') return mode === 'direct';
    if (text === '菜单视频生成') return mode === 'more';
    return false;
  };
  const makeLocator = (items) => ({
    async count() { return items.length; },
    async isVisible() { return items.length > 0; },
    async innerText() { return ''; },
    first() { return this; },
    nth(i) {
      const text = items[i];
      return {
        async isVisible() { return true; },
        async click() {
          calls.push(text);
          if (worksFor(text)) videoMode = true;
        },
      };
    },
  });
  const byText = (pattern) => {
    const src = String((pattern && pattern.source) || '');
    if (/更多技能/.test(src)) return makeLocator(['更多技能 ›']);
    if (/视频生成/.test(src)) return makeLocator(['视频生成']);
    return makeLocator([]);
  };
  const byRole = (role, opts = {}) => {
    const name = String((opts.name && opts.name.source) || opts.name || '');
    if (role === 'menuitem') return makeLocator(mode === 'more' ? ['菜单视频生成'] : []);
    if (/更多技能/.test(name)) return makeLocator(['更多技能 ›']);
    if (/视频生成/.test(name)) return makeLocator(['视频生成']);
    return makeLocator([]);
  };
  const videoControl = {
    async count() { return videoMode ? 1 : 0; },
    async isVisible() { return videoMode; },
    async innerText() { return ''; },
    first() { return videoControl; },
  };
  let menuOpen = false;
  return {
    calls,
    get videoMode() { return videoMode; },
    url() { return 'https://www.doubao.com/chat/'; },
    // 只实现 automation 用到的那几种页面脚本
    async evaluate(fn) {
      const src = String(fn);
      if (src.includes('skill_bar_button_more')) { calls.push('更多技能 ›'); menuOpen = true; return true; }
      if (src.includes('document.body.innerText.includes')) return menuOpen && mode !== 'none';
      if (/===\s*['"]视频生成['"]/.test(src)) {
        calls.push('视频生成');
        if (mode === 'more' || mode === 'direct') videoMode = true;
        return true;
      }
      return false;
    },
    locator(sel) {
      if (sel === '[data-input-engine-actionbar-control-key="video-model"]') return videoControl;
      if (sel === '[data-testid="skill_bar_button_17"]') return makeLocator(['configured']);
      return makeLocator([]);
    },
    getByText: byText,
    getByRole: byRole,
    getByLabel: () => makeLocator([]),
    keyboard: { async press() {} },
  };
}

const signal = new AbortController().signal;
const task = { platform: 'doubao', model: '', ratio: '', duration: null, resolution: '' };
const selectors = { modeControl: '[data-testid="skill_bar_button_17"]' };

test('配置的选择器能进视频模式：直接用，不再找更多技能', async () => {
  const page = fakePage({ mode: 'direct', configuredWorks: true });
  await applyOptions(page, task, selectors, signal, { skillBarTimeoutMs: 0 });
  assert.deepEqual(page.calls, ['configured']);
  assert.equal(page.videoMode, true);
});

test('配置的选择器点了没进视频模式：继续用文字入口', async () => {
  const page = fakePage({ mode: 'direct', configuredWorks: false });
  await applyOptions(page, task, selectors, signal, { skillBarTimeoutMs: 0 });
  assert.equal(page.calls[0], 'configured', '先试配置的');
  assert.ok(page.calls.includes('视频生成'), '再试直接入口');
  assert.equal(page.videoMode, true);
});

test('只能在「更多技能」里找到时，最终也能进视频模式', async () => {
  const page = fakePage({ mode: 'more' });
  await applyOptions(page, task, selectors, signal, { skillBarTimeoutMs: 0 });
  assert.ok(page.calls.length > 0, '要有点击尝试');
  assert.equal(page.videoMode, true, '最后要真的进视频模式');
});

test('两处都没有时给出明确报错', async () => {
  const page = fakePage({ mode: 'none' });
  await assert.rejects(() => applyOptions(page, task, selectors, signal, { skillBarTimeoutMs: 0 }), /没有找到视频模式入口/);
});
