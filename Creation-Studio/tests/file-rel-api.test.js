'use strict';
// 路径规范接口层：
//   POST /api/images/save 带 targetPath（项目相对路径）→ 固定落盘，返回 rel；
//   GET  /api/file?rel=…&projectId=…  → 按当前项目目录读，换根目录也不会断；
//   targetPath 传绝对路径/越界 → 400，不写文件。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 200; i += 1) {
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
  const call = async (url, { method = 'GET', body, raw = false } = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    if (raw) return res;
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || !json.ok) throw new Error(`${url} -> ${res.status} ${JSON.stringify(json)}`);
    return json.data;
  };
  return call;
}

test('项目相对路径：targetPath 固定落盘、rel 地址可读、非法路径拒绝', { timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-rel-api-'));
  const { child, base } = await boot(dir, 18994);
  try {
    const api = client(base);
    await api('/api/auth/register', { method: 'POST', body: { username: 'tester', password: 'secret1' } });
    const project = await api('/api/projects', { method: 'POST', body: { name: '路径接口测试' } });

    const rel = 'assets/素材/人物/第1集-错过，也是彼此成全/林清栀-三视图.png';
    const saved = await api('/api/images/save', {
      method: 'POST',
      body: { data: 'data:image/png;base64,' + PNG.toString('base64'), projectId: project.id, targetPath: rel },
    });
    assert.equal(saved.item.rel, rel);
    const expected = path.join(project.dir, 'assets', '素材', '人物', '第1集-错过，也是彼此成全', '林清栀-三视图.png');
    assert.equal(saved.item.path, expected);
    assert.ok(fs.existsSync(expected), '图要真的落在素材目录');

    // 规范地址能读回来
    const res = await api('/api/file?rel=' + encodeURIComponent(rel) + '&projectId=' + encodeURIComponent(project.id), { raw: true });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.equal((await res.arrayBuffer()).byteLength, PNG.length);

    // 旧式 ?path= 地址仍然可用（历史对话）
    const legacy = await api('/api/file?path=' + encodeURIComponent(expected), { raw: true });
    assert.equal(legacy.status, 200);

    // 绝对路径、越界路径一律拒绝，且不落盘
    for (const bad of [path.join(project.dir, 'assets', 'x.png'), '../x.png', 'D:/x.png']) {
      const out = await api('/api/images/save', {
        method: 'POST',
        body: { data: 'data:image/png;base64,' + PNG.toString('base64'), projectId: project.id, targetPath: bad },
      }).then(() => null, (err) => err);
      assert.ok(out, '应该拒绝：' + bad);
      assert.match(String(out.message), /相对路径|400/, '拒绝原因要说明：' + bad);
    }
    assert.ok(!fs.existsSync(path.join(project.dir, 'assets', 'x.png')), '被拒绝的路径不能留下文件');
  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
});
