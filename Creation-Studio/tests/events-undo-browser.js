'use strict';
// 删除可撤销 + 已完成分镜可重新生成的浏览器验收：node tests/events-undo-browser.js
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const { createRequire } = require('node:module');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const managerRequire = createRequire(path.join(ROOT, '../Video-Generation-Manager/package.json'));
const { chromium } = managerRequire('playwright-core');
const { findChrome } = managerRequire('./src/browser-pool');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, ms = 15000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try { const value = await fn(); if (value) return value; } catch { /* retry */ }
    await sleep(100);
  }
  throw new Error('browser acceptance timeout');
}

function seedJobs(dataDir, mediaFile, projectId) {
  const job = {
    id: 'job-done-1', provider: 'local', workflowId: 'wf-local', status: 'success', stage: '完成', progress: 100,
    title: '镜头 01', shotLabel: '镜头 01', taskTitle: '撤销验收任务', eventId: 'evt_ui_done', eventItemId: 'evt_ui_done_i1',
    projectId, tenantId: 'tnt_default', prompt: 'seed prompt', createdAt: 1, finishedAt: 2, outputDir: path.dirname(mediaFile),
    outputs: [{ type: 'video', name: path.basename(mediaFile), path: mediaFile, bytes: fs.statSync(mediaFile).size, url: '' }],
  };
  // 任务状态已入库；直接写 jobs 表，服务重启后从库里加载。
  const db = new DatabaseSync(path.join(dataDir, 'wmd.sqlite'));
  db.exec('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL DEFAULT \'\',status TEXT NOT NULL,order_no INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,data TEXT NOT NULL)');
  db.prepare('INSERT OR REPLACE INTO jobs(id, project_id, status, order_no, created_at, updated_at, data) VALUES(?,?,?,?,?,?,?)')
    .run(job.id, projectId, job.status, 1, job.createdAt, Date.now(), JSON.stringify(job));
  db.close();
}

function seedEvents(dataDir, projectId) {
  const draft = {
    schemaVersion: 2, version: 1, id: 'evt_ui_draft', title: '待删任务', kind: 'video', source: 'batch', status: 'draft',
    draft: true, pendingSchedule: true, spec: { projectId, items: [] }, audit: [],
    items: [{ id: 'evt_ui_draft_i1', refType: 'job', refId: '', title: '镜头 01', status: 'queued' }],
    createdAt: Date.now(),
  };
  const done = {
    schemaVersion: 2, version: 1, id: 'evt_ui_done', title: '撤销验收任务', kind: 'video', source: 'batch', status: 'completed',
    spec: { projectId, items: [] }, audit: [],
    items: [{ id: 'evt_ui_done_i1', refType: 'job', refId: 'job-done-1', title: '镜头 01', shotLabel: '镜头 01', status: 'queued', attempts: 1, input: { prompt: '原始提示词：抢救室里除颤仪复位', userPrompt: '原始提示词：抢救室里除颤仪复位' } }],
    createdAt: Date.now() - 1000, finishedAt: Date.now(),
  };
  const db = new DatabaseSync(path.join(dataDir, 'task-events.sqlite'));
  db.exec('CREATE TABLE IF NOT EXISTS task_events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,project_id TEXT NOT NULL,tenant_id TEXT NOT NULL DEFAULT \'\',created_at INTEGER NOT NULL,payload TEXT NOT NULL)');
  const insert = db.prepare('INSERT OR REPLACE INTO task_events(id,kind,project_id,tenant_id,created_at,payload) VALUES(?,?,?,?,?,?)');
  insert.run(draft.id, 'video', projectId, 'tnt_default', draft.createdAt, JSON.stringify(draft));
  insert.run(done.id, 'video', projectId, 'tnt_default', done.createdAt, JSON.stringify(done));
  db.close();
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-undo-browser-'));
  const dataDir = path.join(dir, 'data');
  const mediaFile = path.join(dir, 'seed-镜头 01.mp4');
  fs.writeFileSync(mediaFile, Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex'));
  const base = 'http://127.0.0.1:18946';
  let child = null;
  let browser = null;
  // 假管理器：只提供提取需要的账号 / 扫描 / 下载三个接口
  const extractFile = path.join(dir, 'doubao-extract.mp4');
  fs.writeFileSync(extractFile, Buffer.from('00000018667479706d703432 DOUBAO-EXTRACTED-VIDEO-BYTES', 'utf8'));
  const manager = http.createServer(async (req, res) => {
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    const readJson = () => new Promise((resolve) => {
      let raw = '';
      req.on('data', (chunk) => { raw += chunk; });
      req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve({}); } });
    });
    if (req.method === 'GET' && req.url === '/api/extract/accounts') {
      return send(200, { accounts: [{ id: 'acc-1', name: '闲鱼5-我的大豆包', group: '主力', enabled: true }] });
    }
    if (req.method === 'POST' && req.url === '/api/extract/scan') {
      await readJson();
      return send(200, {
        sessionId: 'session-abc',
        account: { id: 'acc-1', name: '闲鱼5-我的大豆包' },
        title: '首尔没有忘记你',
        generating: false,
        videos: [{ key: 'v1', duration: 15, width: 1920, height: 1080, method: 'official-no-watermark', methodLabel: '官方无水印', unwatermarked: true, downloadable: true, poster: '', text: '第5条：抢救室' }],
      });
    }
    if (req.method === 'POST' && req.url === '/api/extract/download') {
      await readJson();
      return send(200, { ok: true, name: '豆包镜头 01.mp4', path: extractFile, size: fs.statSync(extractFile).size, duration: 15 });
    }
    return send(404, { error: 'not found' });
  });
  await new Promise((resolve) => manager.listen(0, '127.0.0.1', resolve));
  const managerUrl = 'http://127.0.0.1:' + manager.address().port;
  const errors = [];
  const start = async () => {
    child = spawn(process.execPath, [path.join(ROOT, 'src/server.js')], {
      cwd: ROOT,
      windowsHide: true,
      env: { ...process.env, WMD_PORT: '18946', WMD_DATA_DIR: dataDir, WMD_PROJECT_ROOT: path.join(dir, 'projects'), WMD_MANAGER_URL: managerUrl },
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
    page.on('pageerror', (error) => errors.push(error.stack || error.message));
    await page.addInitScript(() => {
      window.__errs = [];
      window.addEventListener('error', (evt) => window.__errs.push((evt.error && evt.error.stack) || evt.message || ''));
      window.addEventListener('unhandledrejection', (evt) => window.__errs.push('rejection: ' + String((evt.reason && evt.reason.stack) || evt.reason)));
    });
    await page.goto(base + '/#events');
    await page.fill('#auth-user', 'undo-test');
    await page.fill('#auth-pass', 'undo-test');
    await page.fill('#auth-pass2', 'undo-test');
    await page.getByRole('button', { name: /创建并登录|登录/ }).first().click();
    await page.waitForSelector('#view');

    let seedFile = mediaFile;
    const project = await page.evaluate(async () => {
      const created = await api('/api/projects', { method: 'POST', body: { name: '撤销验收项目', styleId: '' } });
      await fetch('/api/auth/project', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: created.id }) });
      await api('/api/events');
      const media = await api('/api/media');
      return { ...created, mediaRoot: media.root };
    });
    // 成片要落在当前项目的媒体库目录里，媒体库和右键操作用的都是这个 root
    const dayDir = path.join(project.mediaRoot, '2026-10-29', 'job-done-1');
    fs.mkdirSync(dayDir, { recursive: true });
    seedFile = path.join(dayDir, '镜头 01.mp4');
    fs.copyFileSync(mediaFile, seedFile);
    // 任务记录（jobs.json）只在启动时读一次，所以先落盘再重启服务，模拟“已有成片的历史任务”
    seedJobs(dataDir, seedFile, project.id);
    seedEvents(dataDir, project.id);
    await stop();
    await start();

    // 1) 任务页「任务管理」里有回收站入口
    await page.evaluate(() => { location.hash = '#tasks'; });
    await page.reload();
    await page.waitForSelector('[data-task-tab="manage"]');
    await page.locator('[data-task-tab="manage"]').click();
    await page.waitForSelector('[data-event-trash]');

    // 2) 删除任务 → 弹确认 → 提示里带「撤销」→ 点撤销能恢复
    await page.locator('[data-event-delete]').first().click();
    await page.waitForSelector('#evt-delete-confirm');
    await page.locator('#evt-delete-confirm').click();
    await page.waitForSelector('.toast .toast-action');
    assert.match(await page.locator('.toast').last().innerText(), /任务已删除\s*撤销/);
    await page.locator('.toast .toast-action').last().click();
    await until(async () => (await page.locator('[data-event-delete]').count()) >= 2);

    // 3) 回收站弹窗能打开
    await page.locator('[data-event-trash]').click();
    await page.waitForSelector('.modal-body');
    assert.match(await page.locator('.modal-head h2').innerText(), /回收站/);
    await page.locator('[data-close="1"]').first().click();

    // 3.1) 任务清单 JSON：任务 → 镜头 → 提示词 → 成片路径
    await page.locator('[data-event-manifest]').click();
    await page.waitForSelector('.manifest-preview');
    const manifestBody = await page.locator('.modal-body').last().innerText();
    assert.match(manifestBody, /任务\s*2/);
    assert.match(manifestBody, /镜头\s*2/);
    assert.match(manifestBody, /成片\s*1/);
    const preview = await page.locator('.manifest-preview').innerText();
    assert.match(preview, /"shotLabel": "镜头 01"/);
    assert.match(preview, /"prompt": "原始提示词：抢救室里除颤仪复位"/);
    assert.match(preview, /"video": \{/);
    assert.match(preview, /"exists": true/);
    assert.equal(await page.locator('#manifest-download').count(), 1);
    await page.locator('#manifest-save').click();
    const manifestDir = path.join(path.dirname(project.mediaRoot), 'exports', '任务清单');
    const savedFile = await until(() => {
      if (!fs.existsSync(manifestDir)) return null;
      const files = fs.readdirSync(manifestDir).filter((name) => name.endsWith('.json'));
      return files.length ? path.join(manifestDir, files[0]) : null;
    });
    const savedManifest = JSON.parse(fs.readFileSync(savedFile, 'utf8'));
    assert.deepEqual(savedManifest.counts, { tasks: 2, shots: 2, videos: 1 });
    const doneTask = savedManifest.tasks.find((task) => task.eventId === 'evt_ui_done');
    assert.ok(doneTask, '清单里要能找到已完成的任务');
    assert.equal(doneTask.shots[0].shotLabel, '镜头 01');
    assert.equal(doneTask.shots[0].video.exists, true);
    assert.match(doneTask.shots[0].prompt, /原始提示词/);

    // 4) 打开抽屉默认就是「分镜与成片」，记录退到第二个页签
    await page.locator('.evt-row', { hasText: '撤销验收任务' }).locator('[data-event-detail]').click();
    await page.waitForSelector('#evt-drawer', { state: 'attached' });
    assert.equal(await page.locator('[data-drawer-tab="detail"]').getAttribute('aria-selected'), 'true', '默认应停在分镜与成片');
    assert.match(await page.locator('[data-drawer-tab="detail"]').innerText(), /分镜与成片/);
    assert.match(await page.locator('[data-drawer-tab="overview"]').innerText(), /执行记录/);
    assert.equal(await page.locator('[data-drawer-task-action="regen-all"]').count(), 1, '任务上要有「重新生成全部」');
    await page.waitForSelector('.evt-shot-card', { state: 'visible' });
    const card = page.locator('.evt-shot-card').first();
    assert.match(await card.innerText(), /镜头 01/);
    assert.equal(await card.locator('[data-drawer-item-action="regen"]').count(), 1, '成功的分镜要有「重新生成」');
    await card.locator('[data-drawer-item-action="regen"]').click();
    await page.waitForSelector('#drawer-item-regen-ok');
    assert.match(await page.locator('.modal-body').last().innerText(), /现有成片保留/);
    await page.locator('[data-close="1"]').last().click();

    // 5) 成片块右键菜单：重命名 / 替换 / 删除
    const shot = page.locator('.evt-shot-video').first();
    await shot.click({ button: 'right' });
    await page.waitForSelector('.ctx-menu');
    const menu = await page.locator('.ctx-menu').innerText();
    for (const label of ['播放成片', '在文件夹中显示', '重命名成片', '替换成片', '删除成片']) {
      assert.match(menu, new RegExp(label), `右键菜单要有「${label}」`);
    }
    await page.locator('.ctx-menu button', { hasText: '重命名成片' }).click();
    await page.waitForSelector('#out-rename-name');
    await page.fill('#out-rename-name', '镜头 01-定稿');
    await page.locator('#out-rename-ok').click();
    const renamed = await until(async () => page.evaluate(() => api('/api/media').then((data) => data.items.find((item) => item.name.includes('定稿')) || null)));
    assert.equal(renamed.name, '镜头 01-定稿.mp4');
    const shownSrc = await until(async () => {
      const src = await page.locator('.evt-shot-video video').first().getAttribute('src').catch(() => null);
      return src && /%E5%AE%9A%E7%A8%BF|定稿/.test(src) ? src : null;
    });
    assert.match(shownSrc, /定稿|%E5%AE%9A%E7%A8%BF/, '抽屉里的视频块要换成改名后的文件');

    // 6) 点子任务卡片 → 分镜详情弹窗（任务 + 提示词 + 成片）
    await page.locator('.evt-shot-card').first().click({ position: { x: 12, y: 12 } });
    await page.waitForSelector('.shot-modal-grid');
    assert.match(await page.locator('.modal-head h2').last().innerText(), /镜头 01/);
    const modalText = await page.locator('.modal-body').last().innerText();
    assert.match(modalText, /任务[\s\S]*撤销验收任务/);
    assert.match(modalText, /原始提示词：抢救室里除颤仪复位/);
    assert.match(await page.locator('.shot-modal-video video').getAttribute('src'), /%E5%AE%9A%E7%A8%BF|定稿/);

    // 6.1) 弹窗里进编辑：能改提示词，也能换成片
    await page.locator('#shot-edit').click();
    await page.waitForSelector('#revise-prompt');
    assert.equal(await page.locator('#revise-replace').count(), 1, '编辑弹窗要能替换视频');
    assert.equal(await page.locator('.revise-media video').count(), 1, '编辑弹窗里要能看到当前成片');
    assert.equal(await page.locator('#revise-prompt').inputValue(), '原始提示词：抢救室里除颤仪复位');
    await page.fill('#revise-prompt', '改过的提示词：除颤后窦性心律恢复');
    await page.locator('#revise-save').click();
    await until(async () => {
      const text = await page.locator('.evt-shot-card').first().innerText().catch(() => '');
      return text.includes('改过的提示词');
    });

    // 6.2) 换来源：替换成片时能选「豆包链接提取」，走账号名 → 扫描 → 用这个
    await page.locator('.evt-shot-video').first().click({ button: 'right' });
    await page.waitForSelector('.ctx-menu');
    await page.locator('.ctx-menu button', { hasText: '替换成片' }).click();
    await page.waitForSelector('.source-choice');
    assert.match(await page.locator('.modal-body').last().innerText(), /本地文件[\s\S]*豆包链接提取/);
    await page.locator('#source-doubao').click();
    await page.waitForSelector('#extract-url');
    const accountOptions = await page.locator('#extract-account option').allInnerTexts();
    assert.ok(accountOptions.some((text) => text.includes('闲鱼5-我的大豆包')), '账号下拉要带账号名称');
    await page.fill('#extract-url', 'https://www.doubao.com/chat/38449980185337346');
    await page.locator('#extract-scan').click();
    await page.waitForSelector('.extract-item');
    assert.match(await page.locator('.extract-item').innerText(), /官方无水印/);
    assert.match(await page.locator('.extract-item').innerText(), /15 秒/);
    await page.locator('[data-extract-use]').first().click();
    const extractToast = await until(async () => {
      const texts = await page.locator('.toast').allInnerTexts();
      return texts.find((text) => text.includes('提取的视频替换成片')) || null;
    });
    assert.match(extractToast, /已被替换|已用提取的视频替换成片/);
    const afterExtract = await until(async () => {
      const job = await page.evaluate(() => api('/api/jobs?eventId=evt_ui_done').then((data) => (data.jobs || [])[0] || null));
      return job && job.outputs && job.outputs[0] && job.outputs[0].name === '豆包镜头 01.mp4' ? job : null;
    });
    assert.equal(afterExtract.outputs[0].name, '豆包镜头 01.mp4');
    assert.equal(fs.readFileSync(afterExtract.outputs[0].path, 'utf8').includes('DOUBAO-EXTRACTED-VIDEO-BYTES'), true);

    // 7) 回到抽屉，右键删除成片（走完删除链路）
    await page.waitForSelector('.evt-shot-video', { state: 'visible' });
    await page.locator('.evt-shot-video').first().click({ button: 'right' });
    await page.waitForSelector('.ctx-menu');
    await page.locator('.ctx-menu button', { hasText: '删除成片' }).click();
    await page.waitForSelector('#out-delete-ok');
    await page.locator('#out-delete-ok').click();
    await until(async () => (await page.locator('.evt-shot-video.is-empty').count()) === 1);
    const afterDelete = await page.evaluate(() => api('/api/media').then((data) => data.items.length));
    assert.equal(afterDelete, 0, '删除后媒体库里不该再有这条成片');
    const trashed = fs.readdirSync(path.join(project.mediaRoot, '_trash'), { recursive: true });
    assert.ok(trashed.some((name) => String(name).includes('定稿')), '删掉的成片要落在 _trash 里');

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checks: ['trash-entry', 'delete-undo', 'trash-modal', 'task-manifest', 'drawer-default-detail', 'regen-buttons', 'output-context-menu', 'output-rename', 'shot-detail-modal', 'shot-edit-modal', 'extract-replace', 'output-delete'] }));
  } catch (error) {
    try {
      const page = (browser && browser.contexts()[0] && browser.contexts()[0].pages()[0]) || null;
      if (page) console.log('PAGE_ERRORS', JSON.stringify(await page.evaluate(() => window.__errs || [])));
    } catch { /* 页面已关 */ }
    throw error;
  } finally {
    await browser?.close();
    await stop();
    await new Promise((resolve) => manager.close(resolve));
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 留在临时目录 */ }
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
