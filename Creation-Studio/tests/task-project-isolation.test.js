'use strict';
/**
 * 任务管理也按项目隔离：列表、详情、回收站都只看当前项目。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = 18938;
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

test('任务管理：任务只属于自己的项目', { timeout: 90000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-task-isolation-'));
  const child = spawn(process.execPath, [path.resolve(__dirname, '../src/server.js')], {
    env: { ...process.env, WMD_DATA_DIR: dir, APPDATA: path.join(dir, 'appdata'), WMD_PORT: String(PORT), WMD_AGENT_AUTOSTART: '0' },
    stdio: 'ignore',
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${PORT}`;
  try {
    await until(async () => { try { return (await fetch(`${base}/api/health`)).ok; } catch { return false; } });
    const api = client(base);
    await api('/api/auth/register', { method: 'POST', body: { username: 'taskuser', password: 'secret1' } });
    const projectA = (await api('/api/projects', { method: 'POST', body: { name: '任务项目A' } })).data;
    const projectB = (await api('/api/projects', { method: 'POST', body: { name: '任务项目B' } })).data;

    // 直接在事件库里写两条任务，一条属于 A、一条属于 B
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(path.join(dir, 'task-events.sqlite'));
    const stamp = Date.now();
    const makeEvent = (id, projectId, title) => ({
      schemaVersion: 2, version: 1, id, title, kind: 'video', source: 'batch', status: 'partial',
      tenantId: 'tnt_default', spec: { projectId, items: [] }, audit: [],
      items: [{ id: id + '_i', refType: 'job', refId: 'job-' + id, title: '镜头 01', status: 'queued' }],
      createdAt: stamp, finishedAt: stamp,
    });
    const rows = [
      ['evt_proj_a_1', 'projectA', projectA.id, 'A 的任务'],
      ['evt_proj_b_1', 'projectB', projectB.id, 'B 的任务'],
    ];
    for (const [id, , projectId, title] of rows) {
      db.prepare('INSERT OR REPLACE INTO task_events(id,kind,project_id,tenant_id,created_at,payload) VALUES(?,?,?,?,?,?)')
        .run(id, 'video', projectId, 'tnt_default', stamp, JSON.stringify(makeEvent(id, projectId, title)));
    }
    db.close();

    // 当前项目 = A：只看得到 A 的任务
    await api('/api/auth/project', { method: 'POST', body: { projectId: projectA.id } });
    const listA = (await api('/api/events?kind=video')).data;
    const titlesA = (listA.events || listA).map((e) => e.title);
    assert.deepEqual(titlesA, ['A 的任务'], 'A 项目里只能有 A 的任务');

    // B 的任务详情在 A 里打不开
    const peekB = await api('/api/events/evt_proj_b_1', { raw: true });
    assert.equal(peekB.status, 404, '别的项目的任务详情应 404');

    // 删 B 的任务同样 404，A 的可以删进回收站
    const delB = await api('/api/events/evt_proj_b_1', { method: 'DELETE', raw: true });
    assert.equal(delB.status, 404, '不能删别的项目的任务');
    const delA = await api('/api/events/evt_proj_a_1', { method: 'DELETE' });
    assert.equal(delA.ok, true);

    const trashA = (await api('/api/events/trash')).data.items;
    assert.deepEqual(trashA.map((row) => row.id), ['evt_proj_a_1'], '回收站只列当前项目的任务');

    // 当前项目 = B：列表里看不到 A 的任务，回收站也是空的
    await api('/api/auth/project', { method: 'POST', body: { projectId: projectB.id } });
    const listB = (await api('/api/events?kind=video')).data;
    const titlesB = (listB.events || listB).map((e) => e.title);
    assert.deepEqual(titlesB, ['B 的任务'], 'B 项目里只能有 B 的任务');
    const trashB = (await api('/api/events/trash')).data.items;
    assert.deepEqual(trashB, [], 'B 的回收站看不到 A 的任务');

  } finally {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    await delay(200);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
