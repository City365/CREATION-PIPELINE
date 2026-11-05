'use strict';
/**
 * 多租户越权验收：两个租户之间，项目、任务、事件、素材、文件都不能互相看见。
 * 断言一律用 4xx（项目不存在时返回 404，不暴露存在性）。
 */
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

/** 返回 { status, data } 而不抛错，方便断言越权时的 4xx。 */
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
    return { status: res.status, ok: Boolean(json && json.ok), data: json && json.data, error: json && json.error };
  };
}

async function stop(child) {
  child.kill();
  await new Promise((resolve) => child.once('exit', resolve));
}

test('多租户：A 租户的项目、任务、素材、文件对 B 租户不可见', { timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-tenant-'));
  const { child, base } = await boot(dir, 18994);
  try {
    const a = client(base);
    const reg = await a('/api/auth/register', { method: 'POST', body: { username: 'alice', password: 'secret1' } });
    assert.equal(reg.status, 200, '首个用户应注册成功');
    assert.equal(reg.data.user.isAdmin, true, '首个用户是平台管理员');
    assert.ok(reg.data.user.tenantId, '用户应带租户');

    const projectA = (await a('/api/projects', { method: 'POST', body: { name: 'A 的项目' } })).data;
    assert.equal(projectA.tenantId, reg.data.user.tenantId, '新项目归到当前租户');

    const upload = await a('/api/assets/upload', {
      method: 'POST',
      body: { name: 'a.png', data: 'data:image/png;base64,' + PNG.toString('base64'), folder: '场景', type: 'scene' },
    });
    assert.equal(upload.status, 200);
    const assetsA = await a('/api/assets');
    assert.equal(assetsA.data.items.length, 1);
    const assetAbs = assetsA.data.items[0].path || path.join(projectA.dir, 'assets', assetsA.data.items[0].rel || assetsA.data.items[0].name);

    // 平台管理员建第二个租户和用户
    const tenantB = (await a('/api/tenants', { method: 'POST', body: { name: 'B 团队' } })).data;
    assert.ok(tenantB && tenantB.id, '应能创建租户');
    const created = await a('/api/users', { method: 'POST', body: { username: 'bob', password: 'secret2', tenantId: tenantB.id } });
    assert.equal(created.status, 200, '管理员应能创建用户');
    assert.equal(created.data.tenantId, tenantB.id);

    const b = client(base);
    const login = await b('/api/auth/login', { method: 'POST', body: { username: 'bob', password: 'secret2' } });
    assert.equal(login.status, 200);
    assert.equal(login.data.user.tenantId, tenantB.id);

    // 1) 项目列表里看不到 A 的项目
    const listB = await b('/api/projects');
    assert.equal(listB.status, 200);
    assert.ok(!listB.data.some((p) => p.id === projectA.id), 'B 不应看到 A 的项目');

    // 2) 直接按 id 读/改/删 A 的项目：一律 404
    for (const [method, url, body] of [
      ['GET', '/api/projects/' + projectA.id],
      ['PUT', '/api/projects/' + projectA.id, { name: '被改了' }],
      ['DELETE', '/api/projects/' + projectA.id],
    ]) {
      const res = await b(url, { method, body });
      assert.equal(res.status, 404, `${method} ${url} 应返回 404`);
    }

    // 3) 不能把 A 的项目设成自己的当前项目
    const switchRes = await b('/api/auth/project', { method: 'POST', body: { projectId: projectA.id } });
    assert.equal(switchRes.status, 404, '切到别人的项目应 404');

    // 4) 任务、事件、素材都看不到
    const jobsB = await b('/api/jobs');
    assert.equal(jobsB.status, 200);
    assert.equal((jobsB.data.jobs || []).length, 0, 'B 不应看到 A 的任务');
    const eventsB = await b('/api/events');
    assert.equal(eventsB.status, 200);
    assert.equal((eventsB.data.events || []).length, 0, 'B 不应看到 A 的事件');
    const assetsB = await b('/api/assets');
    assert.equal(assetsB.status, 200);
    assert.equal((assetsB.data.items || []).length, 0, 'B 不应看到 A 的素材');

    // 5) 按路径取 A 的素材要拒绝
    const fileRes = await b('/api/media/file?path=' + encodeURIComponent(assetAbs));
    assert.ok(fileRes.status >= 400 && fileRes.status < 500, '按路径读别人的素材应被拒绝，实际 ' + fileRes.status);

    // 6) B 用自己的项目一切正常
    const projectB = (await b('/api/projects', { method: 'POST', body: { name: 'B 的项目' } })).data;
    assert.ok(projectB.id);
    const uploadB = await b('/api/assets/upload', {
      method: 'POST',
      body: { name: 'b.png', data: 'data:image/png;base64,' + PNG.toString('base64'), folder: '场景', type: 'scene' },
    });
    assert.equal(uploadB.status, 200);
    const assetsB2 = await b('/api/assets');
    assert.equal(assetsB2.data.items.length, 1, 'B 应能看到自己的素材');

    // 7) A 仍然只看得到自己的东西
    const listA = await a('/api/projects');
    assert.ok(listA.data.some((p) => p.id === projectA.id));
    assert.ok(!listA.data.some((p) => p.id === projectB.id), 'A 不应看到 B 的项目');
  } finally {
    await stop(child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
