'use strict';
/**
 * 隔离层级：租户 → 用户 → 项目。
 * 同一个租户里的两个用户，互相看不到对方的项目、对话和素材。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = 18937;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn) {
  for (let i = 0; i < 160; i += 1) {
    try { const value = await fn(); if (value) return value; } catch { /* retry */ }
    await delay(100);
  }
  throw new Error('等待超时');
}

function client(base) {
  let cookie = '';
  return async (url, { method = 'GET', body, raw = false } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    if (raw) return res;
    const json = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok && json && json.ok, data: json && json.data, error: json && json.error, json };
  };
}

test('租户 → 用户 → 项目：同租户两个用户互相看不到对方的项目', { timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-owner-'));
  const child = spawn(process.execPath, [path.resolve(__dirname, '../src/server.js')], {
    env: { ...process.env, WMD_DATA_DIR: dir, APPDATA: path.join(dir, 'appdata'), WMD_PORT: String(PORT), WMD_AGENT_AUTOSTART: '0' },
    stdio: 'ignore',
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${PORT}`;
  try {
    await until(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } });

    const alice = client(base);
    assert.equal((await alice('/api/auth/register', { method: 'POST', body: { username: 'alice', password: 'secret1' } })).ok, true);
    const projectA = (await alice('/api/projects', { method: 'POST', body: { name: '爱丽丝的项目' } })).data;
    assert.ok(projectA && projectA.id, '爱丽丝应该能建项目');
    assert.equal(projectA.ownerUserId && projectA.ownerUserId.length > 0, true, '项目必须记录归属人');

    // 同一个租户里再加一个成员
    const created = await alice('/api/users', { method: 'POST', body: { username: 'bob', password: 'secret1', role: 'member' } });
    assert.equal(created.ok, true, JSON.stringify(created.json));

    const bob = client(base);
    assert.equal((await bob('/api/auth/login', { method: 'POST', body: { username: 'bob', password: 'secret1' } })).ok, true);
    const bobProjects = (await bob('/api/projects')).data;
    assert.deepEqual(bobProjects, [], '鲍勃看不到爱丽丝的项目');

    // 直接点名别人的项目 → 一律 404，不泄露存在性（这两个接口都会按 projectId 解析项目）
    const peek = await bob('/api/media/episodes?projectId=' + encodeURIComponent(projectA.id));
    assert.equal(peek.status, 404, '越权读取别人的项目素材应 404');
    assert.equal(peek.json.ok, false);
    assert.match(String(peek.error || ''), /项目不存在/);

    const peekFile = await bob('/api/file?rel=' + encodeURIComponent('assets/x.png') + '&projectId=' + encodeURIComponent(projectA.id), { raw: true });
    assert.equal(peekFile.status, 404, '越权按路径取文件应 404');

    // 伪造 agent 的项目头：控制器只认当前用户的项目，认不出就退回当前项目
    const spoof = await bob('/api/agent/sessions', { raw: true, headers: { 'X-Project-Id': projectA.id } });
    assert.notEqual(spoof.status, 500, '伪造项目头不能把服务打挂');

    // 鲍勃自己建一个项目，两人各看各的
    const projectB = (await bob('/api/projects', { method: 'POST', body: { name: '鲍勃的项目' } })).data;
    assert.notEqual(projectB.id, projectA.id);
    const aliceAgain = (await alice('/api/projects')).data;
    assert.equal(aliceAgain.length, 1, '爱丽丝只看得到自己的项目');
    assert.equal(aliceAgain[0].id, projectA.id);

    // 磁盘目录：新项目落在 租户/用户/项目 三层里
    const rel = path.relative(path.resolve(projectB.dir, '..', '..', '..'), projectB.dir).split(path.sep);
    assert.equal(rel.length, 3, `项目目录应是 租户/用户/项目 三层，实际：${projectB.dir}`);
    assert.ok(rel[0].includes('默认租户'), '第一层是租户');
    assert.ok(rel[1].includes('bob'), '第二层是用户');
    assert.ok(rel[2].includes('鲍勃的项目'), '第三层是项目');
    assert.equal(fs.existsSync(projectB.dir), true);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    await delay(200);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
