'use strict';
// 媒体库分集 + 导入剪映的浏览器验收：npm run test:media-browser
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { if (await fn()) return; } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error('browser acceptance timeout');
}

function box(type, payload) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + payload.length, 0);
  head.write(type, 4, 'ascii');
  return Buffer.concat([head, payload]);
}

function fakeMp4(file) {
  const u32 = (...values) => {
    const buf = Buffer.alloc(values.length * 4);
    values.forEach((value, index) => buf.writeUInt32BE(value >>> 0, index * 4));
    return buf;
  };
  const mvhd = box('mvhd', Buffer.concat([u32(0, 0, 0, 1000, 4000), Buffer.alloc(80)]));
  const tkhd = box('tkhd', Buffer.alloc(84));
  const hdlr = box('hdlr', Buffer.concat([u32(0, 0), Buffer.from('vide', 'ascii'), Buffer.alloc(12), Buffer.from('v\0', 'ascii')]));
  const moov = box('moov', Buffer.concat([mvhd, box('trak', Buffer.concat([tkhd, box('mdia', hdlr)]))]));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([box('ftyp', Buffer.from('isom0000', 'ascii')), moov]));
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-media-browser-'));
  const base = 'http://127.0.0.1:18944';
  const local = path.join(dir, 'local');
  const indexDir = path.join(local, 'JianyingPro', 'User Data', 'Projects', 'com.lveditor.draft');
  const drafts = path.join(dir, 'drafts');
  fs.mkdirSync(indexDir, { recursive: true });
  fs.mkdirSync(drafts, { recursive: true });
  fs.writeFileSync(path.join(indexDir, 'root_meta_info.json'), JSON.stringify({ all_draft_store: [{ draft_name: '旧草稿', draft_id: 'OLD', draft_root_path: drafts }] }));
  let child = null;
  let browser = null;
  const errors = [];
  const start = async () => {
    child = spawn(process.execPath, [path.join(ROOT, 'src/server.js')], {
      cwd: ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        WMD_PORT: '18944',
        WMD_DATA_DIR: path.join(dir, 'data'),
        WMD_PROJECT_ROOT: path.join(dir, 'projects'),
        LOCALAPPDATA: local,
      },
      stdio: 'ignore',
    });
    await until(async () => (await fetch(base + '/api/health')).ok);
  };
  const stop = async () => {
    if (!child) return;
    const stopped = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await stopped;
    child = null;
  };
  try {
    await start();
    browser = await chromium.launch({ executablePath: findChrome(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
    page.setDefaultTimeout(8000);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '/#media');
    await page.fill('#auth-user', 'media-test');
    await page.fill('#auth-pass', 'media-test');
    await page.fill('#auth-pass2', 'media-test');
    await page.getByRole('button', { name: /创建并登录|登录/ }).first().click();
    await page.waitForSelector('#view');

    const project = await page.evaluate(async () => {
      const created = await api('/api/projects', { method: 'POST', body: { name: '分集测试项目', styleId: '' } });
      await fetch('/api/auth/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: created.id }) });
      return created;
    });
    const mediaRoot = await page.evaluate(() => api('/api/media').then((data) => data.root));
    ['镜头 01.mp4', '镜头 02.mp4', '镜头 03.mp4'].forEach((name) => fakeMp4(path.join(mediaRoot, '2026-10-28', 'job-a', name)));

    await page.evaluate(() => { location.hash = '#media'; });
    await page.reload();

    // 默认只出任务菜单，不预加载缩略图
    await page.waitForSelector('.media-task-tile');
    assert.equal(await page.locator('.media-card').count(), 0, '默认视图不该渲染成片卡片');
    const tiles = await page.locator('.media-task-tile').count();
    const coverVideos = await page.locator('.media-task-tile video').count();
    assert.ok(coverVideos <= tiles, '任务菜单最多每个任务一张封面');
    assert.equal(await page.locator('.media-task-tile video[preload="none"]').count(), coverVideos, '封面视频不应预加载');
    const menuText = await page.locator('.media-task-menu').innerText();
    assert.match(menuText, /未记录任务/);
    assert.match(menuText, /视频 3/, '任务菜单要显示条数');

    // 点任务才加载它的成片
    await page.locator('.media-task-tile').first().click();
    await page.waitForSelector('.media-card');
    assert.equal(await page.locator('.media-card').count(), 3);
    assert.match(await page.locator('.media-task-current').innerText(), /未记录任务/);
    assert.equal(await page.locator('[data-act="media-edit"]').count(), 0, '内置剪辑工程入口应已移除');
    assert.match(await page.locator('.ep-hint').innerText(), /剪辑交给剪映/);

    // 返回任务菜单后卡片全部卸载
    await page.locator('[data-act="media-tasks-back"]').click();
    await page.waitForSelector('.media-task-tile');
    assert.equal(await page.locator('.media-card').count(), 0, '返回任务菜单要卸载成片卡片');
    await page.locator('.media-task-tile').first().click();
    await page.waitForSelector('.media-card');

    await page.locator('[data-act="episode-new"]').click();
    await page.fill('#ep-name', '第1集');
    await page.locator('#ep-create-ok').click();
    await until(async () => (await page.locator('.ep-chip').count()) === 3);
    assert.match(await page.locator('.ep-chip').nth(1).innerText(), /第1集/);

    await page.locator('.media-card', { hasText: '镜头 01' }).dragTo(page.locator('.ep-chip').nth(1));
    await page.waitForSelector('.ep-badge');
    assert.equal(await page.locator('.ep-badge').count(), 1);

    await page.locator('.ep-chip').nth(1).click();
    await until(async () => (await page.locator('.media-card').count()) === 1);

    await page.locator('[data-act="jianying-import"]').click();
    await page.waitForSelector('.jy-result');
    const modalText = await page.locator('.jy-result').innerText();
    assert.match(modalText, /分集测试项目-第1集/);
    assert.match(modalText, /1 个片段/);
    const made = fs.readdirSync(drafts);
    assert.deepEqual(made, ['分集测试项目-第1集']);
    const draft = JSON.parse(fs.readFileSync(path.join(drafts, made[0], 'draft_content.json'), 'utf8'));
    assert.equal(draft.tracks[0].segments.length, 1);
    assert.equal(path.basename(draft.materials.videos[0].path), '镜头 01.mp4');
    const index = JSON.parse(fs.readFileSync(path.join(indexDir, 'root_meta_info.json'), 'utf8'));
    assert.equal(index.all_draft_store[0].draft_name, '分集测试项目-第1集');

    // 预览弹窗里只导入当前这一条成片
    await page.locator('[data-close="1"]').first().click();
    await page.locator('.ep-chip').first().click();
    await page.waitForSelector('.media-card');
    await page.locator('.media-card', { hasText: '镜头 02' }).click();
    await page.waitForSelector('#media-preview-jianying');
    assert.equal(await page.locator('#media-preview-edit').count(), 0, '「加入剪辑」应已移除');
    await page.locator('#media-preview-jianying').click();
    await page.waitForSelector('.jy-result');
    assert.match(await page.locator('.jy-result').innerText(), /分集测试项目-镜头 02/);
    const single = JSON.parse(fs.readFileSync(path.join(drafts, '分集测试项目-镜头 02', 'draft_content.json'), 'utf8'));
    assert.equal(single.tracks[0].segments.length, 1);
    assert.equal(path.basename(single.materials.videos[0].path), '镜头 02.mp4');

    // 导入自己生成 / 下载的成片：选本地文件 → 落到 media/<日期>/import-xxx/ → 媒体库按任务名分组
    await page.locator('[data-close="1"]').first().click();
    await page.locator('.ep-chip').first().click();
    await page.waitForSelector('.media-card');
    const outside = path.join(dir, '外部生成.mp4');
    fakeMp4(outside);
    await page.locator('[data-act="media-import"]').click();
    await page.waitForSelector('#media-import-files');
    await page.fill('#media-import-task', '外部任务');
    await page.fill('#media-import-shot', '镜头 12');
    await page.setInputFiles('#media-import-files', outside);
    await page.locator('#media-import-ok').click();
    await until(async () => (await page.locator('.media-card', { hasText: '镜头 12' }).count()) === 1);
    assert.equal(await page.locator('.media-task-group', { hasText: '外部任务' }).count(), 1, '导入的成片要按任务名分组');
    assert.match(await page.locator('.media-card', { hasText: '镜头 12' }).innerText(), /外部生成\.mp4/);
    const importedItem = await page.evaluate(() => api('/api/media').then((data) => data.items.find((item) => item.shotLabel === '镜头 12')));
    assert.ok(importedItem, '媒体库接口应返回刚导入的成片');
    assert.equal(importedItem.taskTitle, '外部任务');
    assert.match(importedItem.rel, /^\d{4}-\d{2}-\d{2}\/import-[0-9a-f]+\/外部生成\.mp4$/);
    assert.deepEqual(fs.readFileSync(importedItem.path), fs.readFileSync(outside), '导入是复制，内容要一致');
    const importParams = JSON.parse(fs.readFileSync(path.join(path.dirname(importedItem.path), 'params.json'), 'utf8'));
    assert.equal(importParams.taskTitle, '外部任务');
    assert.equal(importParams.shotLabel, '镜头 12');
    assert.equal(importParams.imported, true);

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, project: project.name, draft: made[0] }));
  } finally {
    await browser?.close();
    await stop();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 留在临时目录 */ }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
