'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 160; i += 1) {
    try { const value = await fn(); if (value) return value; } catch { /* retry */ }
    await delay(100);
  }
  throw new Error('等待超时');
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function boot(dataDir, port) {
  const child = spawn(process.execPath, [path.resolve(__dirname, '../src/server.js')], {
    env: { ...process.env, WMD_DATA_DIR: dataDir, APPDATA: path.join(dataDir, 'appdata'), WMD_PORT: String(port), WMD_AGENT_AUTOSTART: '0' },
    stdio: 'ignore',
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${port}`;
  await until(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } });
  return { child, base };
}

function client(base) {
  let cookie = '';
  return async (url, { method = 'GET', body } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !json.ok) throw new Error(`${url} -> ${res.status} ${JSON.stringify(json)}`);
    return json.data;
  };
}

async function stop(child) {
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
}

test('项目目录：创建即生成子目录，素材按项目隔离，业务类型可改', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-project-'));
  const { child, base } = await boot(dir, 18992);
  try {
    const api = client(base);
    await api('/api/auth/register', { method: 'POST', body: { username: 'tester', password: 'secret1' } });
    const projectA = await api('/api/projects', { method: 'POST', body: { name: '项目A' } });
    assert.ok(projectA.folder, '项目应有目录名');
    assert.ok(projectA.dir && fs.existsSync(projectA.dir), '项目目录应自动创建');
    for (const sub of ['assets', 'media', 'uploads', 'exports']) {
      assert.ok(fs.existsSync(path.join(projectA.dir, sub)), `缺少子目录 ${sub}`);
    }

    const upload = await api('/api/assets/upload', {
      method: 'POST',
      body: { name: 'scene.png', data: 'data:image/png;base64,' + PNG.toString('base64'), folder: '场景', type: 'scene' },
    });
    assert.equal(upload.type, 'scene');
    const assetsA = await api('/api/assets');
    assert.equal(assetsA.items.length, 1);
    assert.equal(assetsA.items[0].type, 'scene');
    assert.equal(assetsA.items[0].typeLabel, '场景');
    assert.equal(assetsA.root, path.join(projectA.dir, 'assets'));
    assert.equal(assetsA.types.find((type) => type.id === 'scene').count, 1);

    await api('/api/assets/type', { method: 'POST', body: { rel: assetsA.items[0].rel, type: 'character' } });
    const changed = await api('/api/assets');
    assert.equal(changed.items[0].type, 'character');
    assert.equal(changed.items[0].typeLabel, '人物');

    const projectB = await api('/api/projects', { method: 'POST', body: { name: '项目B' } });
    const assetsB = await api('/api/assets');
    assert.equal(assetsB.items.length, 0, '新项目不应看到别的项目素材');
    assert.equal(assetsB.root, path.join(projectB.dir, 'assets'));
    const state = await api('/api/state');
    assert.equal(state.projectId, projectB.id);
    assert.ok(fs.existsSync(projectB.dir));

    await api('/api/auth/project', { method: 'POST', body: { projectId: projectA.id } });
    const back = await api('/api/assets');
    assert.equal(back.items.length, 1, '切回项目 A 应重新看到自己的素材');
    assert.equal(back.items[0].type, 'character');
  } finally {
    await stop(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('迁移：显式迁移旧素材，先备份再收进项目目录并写入标记', { timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-migrate-'));
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'legacy.png'), PNG);
  fs.writeFileSync(path.join(dir, 'assets.json'), JSON.stringify({ subjects: { 'legacy.png': '旧主体' } }));
  fs.writeFileSync(path.join(dir, 'projects.json'), JSON.stringify([{
    id: 'proj-legacy', name: '旧项目', description: '', styleId: '', createdAt: 1, updatedAt: 1,
  }]));
  const { child, base } = await boot(dir, 18993);
  try {
    const api = client(base);
    await api('/api/auth/register', { method: 'POST', body: { username: 'tester', password: 'secret1' } });
    await api('/api/auth/project', { method: 'POST', body: { projectId: 'proj-legacy' } });
    const info = await api('/api/workspace');
    assert.equal(info.migration.counts.assets, 1);
    assert.equal(info.migration.marker, null, '启动时不应自动迁移');

    const record = await api('/api/workspace/migrate', { method: 'POST', body: {} });
    assert.equal(record.projectId, 'proj-legacy');
    assert.ok(record.backups.length >= 1, '迁移前应先备份');
    const listed = (await api('/api/projects')).find((p) => p.id === 'proj-legacy');
    // 迁移记录里的 dir 才是实际写入位置；列表里的 dir 必须和它一致
    const projectDir = record.dir;
    assert.equal(listed && listed.dir, projectDir, '列表里的目录要和迁移记录一致');
    assert.ok(fs.existsSync(path.join(projectDir, 'assets', 'legacy.png')), '旧素材应已迁入项目目录');
    assert.equal(fs.existsSync(path.join(dir, 'assets', 'legacy.png')), false, '旧目录不应再留文件');
    const marker = JSON.parse(fs.readFileSync(path.join(dir, 'workspace-migration.json'), 'utf8'));
    assert.equal(marker.projectId, 'proj-legacy');

    const assets = await api('/api/assets');
    assert.equal(assets.items.length, 1);
    assert.equal(assets.items[0].subject, '旧主体', '旧的主体命名应随迁');
    assert.equal(assets.root, path.join(projectDir, 'assets'));
  } finally {
    await stop(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
