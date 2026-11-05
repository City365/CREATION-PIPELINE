'use strict';
// 场景四视图提示词改由后端智能体按「场景4视图反推」技能推理：
// 这条测试用假智能体（SSE）验证：带了 skill_id、解析出四条提示词、会话用完即删、反问/空回复会报错。
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-scene-agent-'));
process.env.WMD_DATA_DIR = path.join(tmp, 'data');

const SKILL_MARKDOWN = `## A. 坐标系结果
**场景名称**：青竹书房
**空间尺寸**：宽 W = 4.20 m（x，东西）× 深 D = 4.20 m（y，南北）× 层高 H = 3.20 m
**统一外观与光照**：中式古典写实，午后西窗光

## D. 提示词结果
### 1）2×2 四视图合集提示词
\`\`\`text
青竹书房四视图合集：左上正视、右上反视、左下侧视、右下俯视，16:9。
\`\`\`

### 2）正视图提示词
\`\`\`text
青竹书房，宽5米深6米层高3米，摄像机(2.5,0.15,1.6)朝北，画面左西右东。
\`\`\`

### 3）反视图提示词
\`\`\`text
青竹书房，摄像机(2.5,5.4,1.6)朝南，画面左东右西，书架在身后不可见。
\`\`\`

### 4）侧视图提示词
\`\`\`text
青竹书房，摄像机(0.15,3,1.6)朝东，左北右南，书案居中。
\`\`\`

### 5）俯视图提示词
\`\`\`text
青竹书房，摄像机(2.5,3,8)垂直向下，正交去顶，北上西左。
\`\`\`
`;

function startFakeAgent(mode) {
  const state = { transcripts: [], sessions: [], deleted: [], chatBody: null };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const send = (code, payload) => {
        const body = JSON.stringify(payload);
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(body);
      };
      if (url.pathname.startsWith('/agent/sessions/')) {
        if (req.method === 'PUT') { state.sessions.push(url.pathname.split('/').pop()); return send(200, { ok: true }); }
        if (req.method === 'DELETE') { state.deleted.push(url.pathname.split('/').pop()); return send(200, { ok: true }); }
      }
      if (url.pathname === '/agent/chat' && req.method === 'POST') {
        state.chatBody = JSON.parse(raw || '{}');
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const events = mode === 'choice'
          ? [{ type: 'start' }, { type: 'choice', questions: [{ question: '要什么风格？' }], options: [] }]
          : mode === 'nomarkdown'
            ? [{ type: 'start' }, { type: 'delta', text: '```text\n合集\n```\n```text\n正\n```\n```text\n反\n```\n```text\n侧\n```\n```text\n俯\n```' }, { type: 'done' }]
            : [{ type: 'start' }, { type: 'tool_call', tool: 'read_analysis_guidance' }, { type: 'delta', text: SKILL_MARKDOWN.slice(0, 60) }, { type: 'replace', text: SKILL_MARKDOWN }, { type: 'done' }];
        for (const evt of events) res.write('data: ' + JSON.stringify(evt) + '\n\n');
        res.end();
        return;
      }
      send(404, { detail: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port })));
}

async function callRoute(port, body) {
  process.env.WMD_AGENT_URL = 'http://127.0.0.1:' + port;
  delete require.cache[require.resolve('../src/creative-routes')];
  const route = require('../src/creative-routes');
  let response = null;
  const ctx = {
    ok: (_res, data) => { response = { data }; },
    bad: (_res, error, status) => { response = { error, status }; },
    readBody: async () => body,
    mediaPath: (p) => p,
    imageDataUrl: () => 'data:image/png;base64,AA==',
    user: { id: 'tester' },
  };
  await route({ method: 'POST' }, {}, new URL('http://localhost/api/creative/scene/view-prompts'), ctx);
  return response;
}

test('四视图提示词由智能体按技能推理，解析出四条机位提示词', async () => {
  const { server, state, port } = await startFakeAgent('ok');
  try {
    const res = await callRoute(port, { projectId: 'p1', name: '青竹书房', description: '古风木质书房，北墙书架。' });
    assert.ok(res && res.data, JSON.stringify(res));
    assert.equal(state.chatBody.skill_id, 'dir:场景4视图反推', '必须带技能 ID');
    assert.equal(state.chatBody.permission, 'readonly');
    assert.equal(state.chatBody.skill, '场景4视图反推');
    assert.match(state.chatBody.text, /场景名称：青竹书房/);
    assert.match(state.chatBody.text, /不要向我提问/, '要压住反问');
    const views = res.data.views;
    assert.equal(views.length, 4);
    const byId = Object.fromEntries(views.map((v) => [v.id, v.prompt]));
    assert.match(byId.front, /朝北/);
    assert.match(byId.back, /朝南/);
    assert.match(byId.side, /朝东/);
    assert.match(byId.top, /垂直向下/);
    assert.match(res.data.summary, /青竹书房/, 'A 段字段写成 **场景名称**：xxx 也要能取到');
    assert.match(res.data.summary, /4\.20 m/, '尺寸也在摘要里');
    assert.match(res.data.composite, /左上正视/);
    assert.equal(state.sessions.length, 1, '要建一个临时会话');
    assert.deepEqual(state.deleted, state.sessions, '用完要删掉临时会话');
    assert.ok(res.data.agent.tools.includes('read_analysis_guidance'), '智能体应真的去读了技能');
  } finally { server.close(); }
});

test('智能体改成反问用户时直接报错，不返回半成品', async () => {
  const { server, port } = await startFakeAgent('choice');
  try {
    const res = await callRoute(port, { projectId: 'p1', name: '书房', description: '古风书房。' });
    assert.ok(!res.data, '不能返回数据');
    assert.match(res.error, /反问用户/);
  } finally { server.close(); }
});

test('没有小标题时按五个代码块兜底解析', async () => {
  const { server, port } = await startFakeAgent('nomarkdown');
  try {
    const res = await callRoute(port, { projectId: 'p1', name: '书房', description: '古风书房。' });
    assert.ok(res && res.data, JSON.stringify(res));
    const byId = Object.fromEntries(res.data.views.map((v) => [v.id, v.prompt]));
    assert.equal(byId.front, '正');
    assert.equal(byId.back, '反');
    assert.equal(byId.side, '侧');
    assert.equal(byId.top, '俯');
  } finally { server.close(); }
});

test('推理结果按「项目 + 画面条目」落盘，连接断了能取回', async () => {
  const { server, port } = await startFakeAgent('ok');
  const cacheDir = path.join(tmp, 'data', 'scene-view-prompts');
  try {
    const res = await callRoute(port, { projectId: 'p1', name: '青竹书房', description: '古风书房。', itemId: 'item-x' });
    assert.ok(res && res.data, JSON.stringify(res));
    const files = fs.existsSync(cacheDir) ? fs.readdirSync(cacheDir) : [];
    assert.equal(files.length, 1, '要落一份存底');
    const cached = JSON.parse(fs.readFileSync(path.join(cacheDir, files[0]), 'utf8'));
    assert.equal(cached.itemId, 'item-x');
    assert.equal(cached.views.length, 4);
    assert.match(cached.views[0].prompt, /朝北/);
    assert.ok(cached.at, '带时间戳');

    // GET 取回
    delete require.cache[require.resolve('../src/creative-routes')];
    const route = require('../src/creative-routes');
    let got = null;
    await route({ method: 'GET' }, {}, new URL('http://localhost/api/creative/scene/view-prompts/last?projectId=p1&itemId=item-x'), { readBody: async () => ({}), ok: (_, data) => { got = data; }, bad: (_, error, status) => { got = { error, status }; } });
    assert.ok(got && got.views, JSON.stringify(got));
    assert.match(got.views[0].prompt, /朝北/);

    // 没有存底的条目要明确报错
    let missing = null;
    await route({ method: 'GET' }, {}, new URL('http://localhost/api/creative/scene/view-prompts/last?projectId=p1&itemId=item-none'), { readBody: async () => ({}), ok: (_, data) => { missing = data; }, bad: (_, error, status) => { missing = { error, status }; } });
    assert.match(missing.error, /还没有存下过/);
  } finally { server.close(); }
});

test('技能包装在 agent_backend/skills，且只装必要文件', () => {
  const dir = path.join(__dirname, '../agent_backend/skills/场景4视图反推');
  assert.ok(fs.existsSync(path.join(dir, 'SKILL.md')), 'SKILL.md 要在');
  assert.ok(fs.existsSync(path.join(dir, 'references/spatial-rules.md')), '空间规则要在');
  assert.ok(fs.existsSync(path.join(dir, 'templates/output.md')), '输出模板要在');
  assert.ok(!fs.existsSync(path.join(dir, '场景4视图skill')), '重复副本不要装');
  const total = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.md')).reduce((sum, f) => sum + fs.statSync(path.join(dir, f)).size, 0);
  assert.ok(total < 20000, '技能正文要控制在 20KB 以内，实际 ' + total);
});

test.after(() => { try { fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* Windows 上偶尔还有句柄未释放 */ } });
