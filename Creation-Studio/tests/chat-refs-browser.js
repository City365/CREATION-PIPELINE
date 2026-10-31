'use strict';
// 画面参考直接出图的浏览器验收：npm run test:refs-browser
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const managerRequire = createRequire(path.join(ROOT, '../Video-Generation-Manager/package.json'));
const { chromium } = managerRequire('playwright-core');
const { findChrome } = managerRequire('./src/browser-pool');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, ms = 20000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if (await fn()) return; } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error('browser acceptance timeout');
}

// 造小尺寸真 PNG，用来验证图位会跟着图片比例变
const zlib = require('node:zlib');

function pngOf(width, height, [r, g, b]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 3 + 1);
    for (let x = 0; x < width; x += 1) {
      const at = row + 1 + x * 3;
      raw[at] = r; raw[at + 1] = g; raw[at + 2] = b;
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const LANDSCAPE = pngOf(160, 90, [220, 180, 120]);
const PORTRAIT = pngOf(90, 160, [120, 180, 220]);

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-refs-browser-'));
  const base = 'http://127.0.0.1:18948';
  let hits = 0;
  const fake = http.createServer((req, res) => {
    if (req.method === 'POST' && /images\/generations/.test(req.url || '')) {
      hits += 1;
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const portrait = /portrait/i.test(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ b64_json: (portrait ? PORTRAIT : LANDSCAPE).toString('base64') }] }));
      });
      return;
    }
    res.writeHead(404).end('{}');
  });
  await new Promise((resolve) => fake.listen(18949, '127.0.0.1', resolve));

  let child = null;
  let browser = null;
  const errors = [];
  const describeCalls = [];
  try {
    child = spawn(process.execPath, [path.join(ROOT, 'src/server.js')], {
      cwd: ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        WMD_PORT: '18948',
        WMD_DATA_DIR: path.join(dir, 'data'),
        WMD_PROJECT_ROOT: path.join(dir, 'projects'),
        LOCALAPPDATA: path.join(dir, 'local'),
      },
      stdio: 'ignore',
    });
    await until(async () => (await fetch(base + '/api/health')).ok);

    const reg = await fetch(base + '/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'refs-test', password: 'refs-test' }),
    });
    const cookie = String(reg.headers.getSetCookie?.()[0] || reg.headers.get('set-cookie') || '').split(';')[0];
    const [name, value] = cookie.split('=');
    const api = (p, body) => fetch(base + p, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json());

    const project = await api('/api/projects', { name: '参考图项目', styleId: '' });
    await fetch(base + '/api/auth/project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ projectId: project.data.id }),
    });
    await api('/api/channels', {
      kind: 'image',
      name: '本地假图',
      type: 'openai-images',
      baseUrl: 'http://127.0.0.1:18949/v1',
      apiKey: 'test-only',
      model: 'fake-image',
      active: true,
    });

    browser = await chromium.launch({ executablePath: findChrome(), headless: true });
    const context = await browser.newContext({ viewport: { width: 1500, height: 960 } });
    await context.addCookies([{ name, value, domain: '127.0.0.1', path: '/' }]);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (/images\/describe/.test(request.url())) describeCalls.push(request.url());
    });
    page.on('response', async (response) => {
      if (/api\/chat\/ref-image/.test(response.url())) {
        try { console.log('ref-image', response.status(), (await response.text()).slice(0, 200)); } catch { /* ignore */ }
      }
    });
    await page.goto(base + '/#script');
    await page.waitForSelector('#view');
    await until(async () => page.evaluate(() => typeof window.guRefCardHtml === 'function' && typeof window.guHydrateRefs === 'function'));
    try {
      await page.waitForSelector('#ask-messages', { timeout: 15000 });
    } catch (error) {
      const diag = await page.evaluate(() => ({ hash: location.hash, host: document.querySelector('.route-host')?.className || 'none', h1: document.querySelector('.page-head h1')?.textContent || '' }));
      throw new Error('没进到对话页：' + JSON.stringify(diag));
    }

    const prompt = 'vast Chinese celestial palace complex, golden sunrise, floating islands';
    // 探针挂在对话页的 route-host 里（能收到委托点击）；页面重绘会清掉它，所以挂完确认还在，
    // 被重绘刷掉就重来一次，避免把首屏异步渲染的时序当成功能失败
    const mountProbe = async (prompts) => {
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await page.evaluate((list) => {
          document.getElementById('ref-probe')?.remove();
          const probe = document.createElement('div');
          probe.id = 'ref-probe';
          probe.style.cssText = 'position:fixed;left:16px;top:16px;width:520px;z-index:99999;background:#fff';
          probe.innerHTML = `<div class="gu-card"><div class="gu-grid gu-ref-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,236px));gap:10px">${list.map((p) => guRefCardHtml(p)).join('')}</div></div>`;
          (document.querySelector('.route-host') || document.body).appendChild(probe);
          guHydrateRefs(probe);
        }, prompts);
        await page.waitForTimeout(300);
        if (await page.evaluate(() => !!document.getElementById('ref-probe'))) return;
      }
      throw new Error('探针连续被页面重绘刷掉，没能在对话页里挂住');
    };
    await page.waitForTimeout(1500); // 等首屏的模型 / 技能加载完，避免注入后马上被重绘刷掉
    await mountProbe([prompt]);

    await page.waitForSelector('#ref-probe [data-gu-ref] img');
    const state = await page.evaluate(() => {
      const node = document.querySelector('#ref-probe [data-gu-ref]');
      const img = node.querySelector('img');
      const box = node.querySelector('.gu-ref-media').getBoundingClientRect();
      return { state: node.dataset.guState, src: img.getAttribute('src'), badge: node.querySelector('.gu-ref-badge')?.textContent || '', height: Math.round(box.height), width: Math.round(box.width), ratio: node.dataset.guRatio };
    });
    assert.equal(state.state, 'ready');
    assert.ok(state.height <= 240, `参考图高度应被限制，实际 ${state.height}px`);
    assert.ok(state.width > 0);

    // 横图（160×90 → 16:9）：图位按 16:9 摆，宽 236、高 133 左右
    assert.equal(state.ratio, '16:9', '图位跟着图片比例走');
    assert.ok(state.width > state.height, '横图要宽而扁');
    assert.ok(Math.abs(state.width / state.height - 16 / 9) < 0.1, `比例应接近 16:9，实际 ${state.width}×${state.height}`);
    assert.match(state.src, /^\/api\/file\?path=/);
    assert.equal(state.badge, '自动生成');
    assert.equal(hits, 1, '应该真的调了一次出图接口');

    const img = await page.request.get(base + state.src);
    assert.equal(img.status(), 200);
    assert.match(String(img.headers()['content-type']), /image\/png/);

    // 重新渲染同一张参考：直接用缓存，不再出图
    await mountProbe([prompt]);
    await page.waitForSelector('#ref-probe [data-gu-ref] img');
    assert.equal(hits, 1, '同一条描述不应重复出图');

    // 刷新页面：本机记住了图片地址，直接按已就绪渲染，不再请求渠道也不再花钱
    await page.waitForTimeout(700); // 等记忆落盘（防抖 400ms）
    const hitsBeforeReload = hits;
    await page.reload();
    await page.waitForSelector('#ask-messages');
    await mountProbe([prompt]);
    await page.waitForSelector('#ref-probe [data-gu-ref][data-gu-state="ready"] img');
    const afterReload = await page.evaluate(() => {
      const node = document.querySelector('#ref-probe [data-gu-ref]');
      return { src: node?.querySelector('img')?.getAttribute('src') || '', ratio: node?.dataset.guRatio || '' };
    });
    assert.equal(hits, hitsBeforeReload, '刷新后不应再调用出图渠道');
    assert.equal(afterReload.src, state.src, '刷新后复用同一张已生成的图');
    assert.equal(afterReload.ratio, '16:9', '图位比例也一起记住');

    // 顶栏的出图开关：关掉之后一张都不再生成
    const toggle = page.locator('[data-act="ask-toggle-refs"]');
    assert.equal(await toggle.count(), 1, '顶栏要有出图开关');
    assert.match(await toggle.innerText(), /出图/);
    await toggle.click();
    await page.waitForFunction(() => document.querySelector('[data-act="ask-toggle-refs"]')?.getAttribute('aria-pressed') === 'false');
    await mountProbe(['first prompt must not generate', 'second prompt click me', 'third prompt must not generate']);
    await page.waitForTimeout(800);
    assert.equal(hits, 1, '关掉开关后不应再调用出图接口');
    assert.match(await page.evaluate(() => document.querySelector('#ref-probe [data-gu-ref]').innerText), /first prompt must not generate/, '没图时图位里就是提示词');
    const offStates = await page.evaluate(() => [...document.querySelectorAll('#ref-probe [data-gu-ref]')].map((n) => n.dataset.guState));
    assert.deepEqual(offStates, ['off', 'off', 'off'], '没开启时三张都只是占位');
    const btnCount = await page.evaluate(() => [...document.querySelectorAll('#ref-probe [data-gu-ref]')].map((n) => n.querySelectorAll('.gu-ref-btn').length));
    assert.deepEqual(btnCount, [3, 3, 3], '每张卡右上角三个按钮一直都在');
    const offBox = await page.evaluate(() => {
      const box = document.querySelector('#ref-probe .gu-ref-media').getBoundingClientRect();
      return { w: Math.round(box.width), h: Math.round(box.height), ratio: document.querySelector('#ref-probe [data-gu-ref]').dataset.guRatio };
    });
    assert.equal(offBox.ratio, '4:3', '没给比例时按 4:3 占位');
    assert.ok(offBox.h > 100 && offBox.h <= 220, `占位高度要合理，实际 ${offBox.h}`);
    assert.equal(await page.evaluate(() => localStorage.getItem('wmd.askRefImages')), '0', '开关状态要记住');

    // 点第二张的「生成」：只出这一张，另外两张不动，全局开关也不变
    const beforeManual = hits;
    await page.locator('#ref-probe [data-gu-ref]').nth(1).locator('[data-act="ask-ref-now"]').click();
    await until(async () => hits === beforeManual + 1);
    await until(async () => page.evaluate(() => document.querySelectorAll('#ref-probe [data-gu-ref]')[1].dataset.guState === 'ready'));
    const afterManual = await page.evaluate(() => [...document.querySelectorAll('#ref-probe [data-gu-ref]')].map((n) => n.dataset.guState));
    assert.deepEqual(afterManual, ['off', 'ready', 'off'], '只生成被点的那一张');
    assert.equal(hits, beforeManual + 1, '只应该多发一次请求');
    assert.equal(await page.evaluate(() => localStorage.getItem('wmd.askRefImages')), '0', '单张生成不改全局开关');
    const secondSrc = await page.evaluate(() => document.querySelectorAll('#ref-probe [data-gu-ref]')[1].querySelector('img')?.getAttribute('src') || '');
    const manualImg = await page.request.get(base + secondSrc);
    assert.equal(manualImg.status(), 200);

    // 出图后：只显示图片，下载按钮带上地址，复制拿到的仍是提示词
    const readyInfo = await page.evaluate(() => {
      const card = document.querySelectorAll('#ref-probe [data-gu-ref]')[1];
      return {
        hasPrompt: Boolean(card.querySelector('.gu-ref-prompt')),
        downloadUrl: card.querySelector('[data-act="gu-ref-download"]')?.getAttribute('data-url') || '',
        downloadDisabled: Boolean(card.querySelector('[data-act="gu-ref-download"]')?.disabled),
        copyText: card.querySelector('[data-act="gu-copy-text"]')?.getAttribute('data-gu-text') || '',
      };
    });
    assert.equal(readyInfo.hasPrompt, false, '有图就只显示图片');
    assert.match(readyInfo.downloadUrl, /^\/api\/file\?path=/);
    assert.equal(readyInfo.downloadDisabled, false);
    assert.equal(readyInfo.copyText, 'second prompt click me', '复制的是提示词，不是图片');
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
    await page.locator('#ref-probe [data-gu-ref]').nth(1).locator('[data-act="gu-copy-text"]').click();
    await until(async () => (await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))) === 'second prompt click me');
    const downloadHref = await page.evaluate(() => {
      const btn = document.querySelectorAll('#ref-probe [data-gu-ref]')[1].querySelector('[data-act="gu-ref-download"]');
      return btn.getAttribute('data-url');
    });
    const downloaded = await page.request.get(base + downloadHref + '&download=1');
    assert.equal(downloaded.status(), 200);
    assert.match(String(downloaded.headers()['content-disposition'] || ''), /attachment/, '下载要带附件头');

    // 竖图（90×160 → 9:16）：图位也跟着变竖，不再一律横着塞
    await mountProbe(['portrait Korean actress in the rain, vertical movie poster']);
    await page.locator('#ref-probe [data-gu-ref] [data-act="ask-ref-now"]').first().click();
    let tallBox = null;
    for (let i = 0; i < 120 && !tallBox; i += 1) {
      tallBox = await page.evaluate(() => {
        const node = document.querySelector('#ref-probe [data-gu-ref]');
        const img = node && node.querySelector('img');
        if (!node || node.dataset.guState !== 'ready' || !img || !img.naturalWidth) return null;
        const box = node.querySelector('.gu-ref-media').getBoundingClientRect();
        return { w: Math.round(box.width), h: Math.round(box.height), ratio: node.dataset.guRatio, natural: `${img.naturalWidth}x${img.naturalHeight}` };
      });
      if (!tallBox) await sleep(150);
    }
    assert.ok(tallBox, '竖图应该出图并贴合图位');
    assert.equal(tallBox.natural, '90x160');
    assert.equal(tallBox.ratio, '9:16', '图位跟着图片比例走');
    assert.ok(tallBox.h > tallBox.w, `竖图要窄而高，实际 ${tallBox.w}×${tallBox.h}`);
    assert.ok(Math.abs(tallBox.w / tallBox.h - 9 / 16) < 0.06, `比例应接近 9:16，实际 ${tallBox.w}×${tallBox.h}`);

    // 尺寸写在标签上：就算样式表挂掉／是旧版本，占位也不能被撑成一大块
    await page.evaluate(() => localStorage.setItem('wmd.askRefImages', '1'));
    await page.route('**/styles.css*', (route) => route.abort());
    await page.reload();
    await page.waitForSelector('#ask-messages');
    await page.waitForTimeout(400);
    await mountProbe(['no stylesheet ref card']);
    await page.waitForSelector('#ref-probe [data-gu-ref] img');
    const noCss = await page.evaluate(() => {
      const media = document.querySelector('#ref-probe .gu-ref-media');
      const card = document.querySelector('#ref-probe .gu-ref');
      return { media: Math.round(media.getBoundingClientRect().height), card: Math.round(card.getBoundingClientRect().width) };
    });
    assert.ok(noCss.media <= 200, `没有样式表时占位也不能超过 200px，实际 ${noCss.media}`);
    assert.ok(noCss.card <= 260, `没有样式表时卡片宽度也要收住，实际 ${noCss.card}`);

    assert.deepEqual(describeCalls, [], '参考出图不应该走反推/识别');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, hits, src: state.src, noCss }));
  } finally {
    await browser?.close();
    child?.kill();
    await new Promise((resolve) => fake.close(resolve));
    await sleep(200);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 留在临时目录 */ }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
