'use strict';
// 剪辑台在产品路由上的验收（npm run test:concat-product-browser）。
//
// 为什么单独一套：这个页面以前的验收全都对着 integrations/concat-v1.html 那个自检页，
// 而产品真正挂载的是 app.js 里的 #concat —— 那条路把 host 传过去就不管了，于是
// 「从哪个工程点进来都打开同一个上次留下的工程」这种错，59 个测试一个都没发现。
// 这套只量产品路由：点进来要开对工程、退出再进来要记得、页面结构要是设计好的那套。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const managerRequire = createRequire(path.join(ROOT, '../Video-Generation-Manager/package.json'));
const { chromium } = managerRequire('playwright-core');
const { findChrome } = managerRequire('./src/browser-pool');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 25000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if (await fn()) return; } catch { /* keep waiting */ }
    await sleep(150);
  }
  throw Error('browser acceptance timeout');
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-concat-browser-'));
  const base = 'http://127.0.0.1:18945';
  const concatRoot = path.join(dir, 'concat');
  fs.mkdirSync(concatRoot, { recursive: true });
  let child = null;
  let browser = null;
  const errors = [];

  const start = async () => {
    child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
      cwd: ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        WMD_PORT: '18945',
        WMD_DATA_DIR: path.join(dir, 'data'),
        APPDATA: path.join(dir, 'appdata'),
        // 引擎只许在这个临时目录里建工程，别动真 output
        WMD_CONCAT_ROOT: concatRoot,
      },
      stdio: 'ignore',
    });
    await until(async () => (await fetch(base + '/api/health')).ok);
  };
  const stop = async () => {
    if (!child) return;
    const stopped = new Promise((r) => child.once('exit', r));
    child.kill();
    await stopped;
    child = null;
  };
  let sessionCookie = '';
  const call = async (p, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (sessionCookie) headers.Cookie = sessionCookie;
    const r = await fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });
    const d = await r.json();
    assert.equal(d.ok, true, p + ' → ' + JSON.stringify(d));
    return d.data;
  };

  try {
    await start();
    // 注册接口注册即登录，直接把会话 cookie 塞给浏览器：这套验收的对象是剪辑台，
    // 不是登录页，登录表单的 DOM 变了不该让它红。
    const registered = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'concat-accept', password: 'concat-accept' }),
    });
    const sessionCookieRow = (registered.headers.getSetCookie ? registered.headers.getSetCookie() : [registered.headers.get('set-cookie')])
      .filter(Boolean)
      .map((row) => row.split(';')[0])
      .find((row) => row.startsWith('wmd_session='));
    assert.ok(sessionCookieRow, '注册没给会话 cookie：' + registered.status);
    sessionCookie = sessionCookieRow;

    const project = await call('/api/projects', { name: '剪辑台验收工程', styleId: '' });
    const projectId = project.id || (project.project && project.project.id);
    assert.ok(projectId, '建工程没拿到 id');

    browser = await chromium.launch({ executablePath: findChrome(), headless: true });
    const context = await browser.newContext({ viewport: { width: 1680, height: 1000 } });
    const name = sessionCookie.split('=')[0];
    const value = decodeURIComponent(sessionCookie.slice(name.length + 1));
    await context.addCookies([{ name, value, domain: '127.0.0.1', path: '/' }]);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

    await page.goto(base + '/#concat');

    await page.waitForSelector('#ce-host', { timeout: 25000 });
    await until(async () => await page.evaluate(() => Boolean(window.CONCAT_EDITOR && window.CONCAT_EDITOR.instance)));

    // 1) 产品路由把当前工程传下去了
    const options = await page.evaluate(() => window.CONCAT_EDITOR.options());
    assert.equal(options.projectId, projectId, 'mount 要收到当前工程的 id（以前收到也不理）');
    assert.equal(options.projectName, '剪辑台验收工程', 'mount 要收到工程名');

    // 2) 第一次进来没有引擎工程 → 选择器摊开，工程名已预填
    await until(async () => await page.evaluate(() => Boolean(document.querySelector('.ce-picker'))));
    assert.equal(await page.inputValue('.ce-path-open input:not([placeholder^="工程目录"])'), '剪辑台验收工程', '新建工程名要按创作台的工程名预填');

    // 3) 引擎工程用传输层直接建（页面建的按钮无头下不好点，这条验收的对象是「开对工程」），
    //    然后像用户那样在选择器里点它。
    const internal = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'internal-token.json'), 'utf8')).token;
    const rpc = async (calls) => {
      const r = await fetch(base + '/api/concat/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-wmd-internal': internal },
        body: JSON.stringify({ calls, drain: false }),
      });
      const d = await r.json();
      assert.equal(d.ok, true, JSON.stringify(d));
      return d.data.replies;
    };
    const created = await rpc([{ method: 'project.create', params: { location: concatRoot, name: '剪辑台验收工程' } }]);
    assert.equal(created[0].ok, true, '引擎没建成工程：' + JSON.stringify(created[0]));
    await page.waitForSelector('.ce-picker .ce-projects li button', { timeout: 20000 });
    await page.locator('.ce-picker .ce-projects li button').first().click();
    await until(async () => await page.evaluate(() => {
      const i = window.CONCAT_EDITOR.instance;
      return Boolean(i && i.projectPath && i.doc);
    }));
    try {
      await until(async () => await page.evaluate(() => {
        const i = window.CONCAT_EDITOR.instance;
        return Boolean(i && i.projectPath && i.doc);
      }));
    } catch (error) {
      const state = await page.evaluate(() => {
        const i = window.CONCAT_EDITOR.instance;
        return { error: i.error, notice: i.notice, busy: i.busy, engineOn: i.engineOn, engineError: i.engineError, root: i.engineRoot, projects: (i.projects || []).map((p) => p.path), newName: i.newProjectName };
      });
      throw Error('新建引擎工程没成功：' + JSON.stringify(state) + '\n页面错误：' + JSON.stringify(errors));
    }
    const opened = await page.evaluate(() => {
      const i = window.CONCAT_EDITOR.instance;
      return { path: i.projectPath, name: i.projectName, tabs: i.tabs.length };
    });
    assert.ok(opened.path && opened.path.startsWith(concatRoot), '引擎工程要建在引擎根目录下：' + opened.path);
    assert.equal(opened.tabs, 9, '页签是 9 个（调节只在右栏）');

    // 4) 版式：一格一格的定宽页签、字号只有四档、两块面板不横滚、没有死控件
    const layout = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('.ce-tab')).map((el) => {
        const span = el.querySelector('span');
        return {
          label: el.textContent.trim(),
          w: Math.round(el.getBoundingClientRect().width),
          clipped: span ? span.scrollWidth > span.clientWidth + 1 : false,
        };
      });
      const sizes = new Set();
      document.querySelectorAll('.ce-shell *').forEach((el) => {
        if (Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) sizes.add(getComputedStyle(el).fontSize);
      });
      const box = (sel) => {
        const el = document.querySelector(sel);
        return el ? { over: el.scrollWidth > el.clientWidth + 1, ox: getComputedStyle(el).overflowX } : null;
      };
      const banned = ['–', '□', '✕', '⤢', '🔒', '⋮⋮'];
      const glyphs = Array.from(document.querySelectorAll('.ce-shell button, .ce-shell i')).map((el) => el.textContent.trim());
      return {
        tabs,
        sizes: Array.from(sizes).sort((a, b) => parseFloat(a) - parseFloat(b)),
        left: box('.ce-left-body'),
        right: box('.ce-details'),
        banned: glyphs.filter((t) => banned.includes(t)),
        winbtns: Boolean(document.querySelector('.ce-winbtns')),
        splitter: Boolean(document.querySelector('.ce-splitter')),
        timelineHeight: Math.round((document.querySelector('.ce-tl') || { getBoundingClientRect: () => ({ height: 0 }) }).getBoundingClientRect().height),
      };
    });
    assert.equal(layout.tabs.length, 9);
    assert.deepEqual(layout.tabs.map((t) => t.label), ['▤素材', '♫音频', 'T文本', '❖贴纸', '✦特效', '⇄转场', '≡字幕', '◐滤镜', '▣模板']);
    assert.ok(layout.tabs.every((t) => t.w >= 40), '页签格子太窄：' + layout.tabs.map((t) => t.w).join('/'));
    assert.ok(layout.tabs.every((t) => !t.clipped), '页签文字被省略号切了：' + JSON.stringify(layout.tabs));
    assert.deepEqual(layout.sizes, ['10px', '11px', '12px', '14px'], '字号只允许四档：' + layout.sizes.join('/'));
    assert.equal(layout.left.over, false, '素材面板不该横滚');
    assert.equal(layout.right.over, false, '详情栏不该横滚');
    assert.equal(layout.left.ox, 'hidden');
    assert.equal(layout.right.ox, 'hidden');
    assert.deepEqual(layout.banned, [], '还有死控件：' + layout.banned.join(''));
    assert.equal(layout.winbtns, false, '假窗口按钮要删掉');
    assert.equal(layout.splitter, true, '时间线上面要有可拖的分割条');
    assert.ok(layout.timelineHeight > 200, '时间线默认要占一块：' + layout.timelineHeight);

    // 5) 退出再进来：这个创作台工程记得上次开的引擎工程
    await page.reload();
    await page.waitForSelector('.ce-shell', { timeout: 25000 });
    await until(async () => await page.evaluate(() => {
      const i = window.CONCAT_EDITOR.instance;
      return Boolean(i && i.projectPath);
    }));
    const again = await page.evaluate(() => window.CONCAT_EDITOR.instance.projectPath);
    assert.equal(again, opened.path, '再进来要开同一个引擎工程（这就是以前一直错的那条）');
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.ce-picker'))), false, '记得工程就不该再摊开选择器');

    // 6) 换一个创作台工程进来：不能沿用上一个工程开的引擎工程
    const other = await call('/api/projects', { name: '另一个工程', styleId: '' });
    const otherId = other.id || (other.project && other.project.id);
    await page.evaluate((id) => { localStorage.setItem('wmd.projectId', id); location.hash = '#projects'; }, otherId);
    await page.waitForTimeout(600);
    await page.evaluate(() => { location.hash = '#concat'; });
    await page.waitForSelector('#ce-host', { timeout: 20000 });
    await until(async () => await page.evaluate(() => Boolean(document.querySelector('.ce-picker'))));
    const otherOptions = await page.evaluate(() => window.CONCAT_EDITOR.options());
    assert.equal(otherOptions.projectId, otherId);
    assert.equal(await page.inputValue('.ce-path-open input:not([placeholder^="工程目录"])'), '另一个工程', '换工程后预填名要跟着换');

    assert.deepEqual(errors, [], '页面不该报错');
    console.log(JSON.stringify({
      passed: true,
      checks: [
        'mount 收到当前工程 id/名字',
        '没有引擎工程时摊开选择器并预填工程名',
        '新建的引擎工程落在引擎根目录',
        '9 个定宽页签、无一被省略号切',
        '字号只有 10/11/12/14 四档',
        '两块面板都不横滚',
        '死控件清空',
        '时间线分割条在',
        '重进同一个工程记得引擎工程',
        '换创作台工程不沿用上一个',
      ],
    }));
  } finally {
    await browser?.close();
    await stop();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
