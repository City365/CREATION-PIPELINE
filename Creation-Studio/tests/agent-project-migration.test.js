'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const migrate = require('../src/workspace-migrate');

test('智能体会话按项目迁移：h3-studio 的历史会话归入目标项目并先备份', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-agent-migrate-'));
  const dbFile = path.join(dir, 'conversations.db');
  const db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE conversations (project TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project,id))');
  db.exec('CREATE TABLE executions (project TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project,id))');
  db.exec('CREATE TABLE trajectory_events (project TEXT NOT NULL, session_id TEXT NOT NULL, run_id TEXT NOT NULL, seq INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project,run_id,seq))');
  db.exec('CREATE TABLE compactions (project TEXT NOT NULL, session_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project,session_id))');
  db.prepare('INSERT INTO conversations VALUES (?,?,?)').run('h3-studio', 'c1', '{}');
  db.prepare('INSERT INTO conversations VALUES (?,?,?)').run('h3-studio', 'c2', '{}');
  db.prepare('INSERT INTO conversations VALUES (?,?,?)').run('other', 'c3', '{}');
  db.prepare('INSERT INTO executions VALUES (?,?,?)').run('h3-studio', 'r1', '{}');
  db.prepare('INSERT INTO trajectory_events VALUES (?,?,?,?,?)').run('h3-studio', 'c1', 'r1', 0, '{}');
  db.prepare('INSERT INTO compactions VALUES (?,?,?)').run('h3-studio', 'c1', '{}');
  db.close();

  const previous = process.env.H3_AGENT_DB;
  process.env.H3_AGENT_DB = dbFile;
  try {
    const backupDir = path.join(dir, 'backup');
    const changed = migrate.migrateAgentSessions('proj-target', backupDir);
    assert.equal(changed, 5, '两个会话 + 运行 + 轨迹 + 压缩上下文都应迁移');
    assert.ok(fs.existsSync(path.join(backupDir, 'conversations.db')), '迁移前应备份会话库');
    const check = new DatabaseSync(dbFile);
    const rows = check.prepare('SELECT project, id FROM conversations ORDER BY id').all();
    check.close();
    assert.deepEqual(rows.map((row) => [row.project, row.id]), [['proj-target', 'c1'], ['proj-target', 'c2'], ['other', 'c3']]);
  } finally {
    if (previous === undefined) delete process.env.H3_AGENT_DB;
    else process.env.H3_AGENT_DB = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('智能体迁移幂等：没有旧项目数据时不改动', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'h3-agent-migrate-'));
  const dbFile = path.join(dir, 'conversations.db');
  const db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE conversations (project TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project,id))');
  db.prepare('INSERT INTO conversations VALUES (?,?,?)').run('proj-target', 'c1', '{}');
  db.close();
  const previous = process.env.H3_AGENT_DB;
  process.env.H3_AGENT_DB = dbFile;
  try {
    assert.equal(migrate.migrateAgentSessions('proj-target', ''), 0);
    const check = new DatabaseSync(dbFile);
    const count = check.prepare('SELECT COUNT(*) AS n FROM conversations').get().n;
    check.close();
    assert.equal(count, 1);
  } finally {
    if (previous === undefined) delete process.env.H3_AGENT_DB;
    else process.env.H3_AGENT_DB = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
