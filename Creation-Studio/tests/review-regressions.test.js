'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFile, execFileSync } = require('node:child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-review-regressions-'));
process.env.WMD_DATA_DIR = path.join(tmp, 'data');
process.env.APPDATA = path.join(tmp, 'no-legacy');
delete process.env.WMD_INTERNAL_TOKEN;
const config = require('../src/config');
config.load();
config.save({ channels: { llm: [], image: [], video: [] }, autodlKeys: [] });
const { server } = require('../src/server');
const internal = require('../src/internal-auth');
const channels = require('../src/channels');
const jobs = require('../src/jobs');
let base, mockBase;
const requests = [];
const mock = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  requests.push({ path: req.url, body });
  res.setHeader('Content-Type', 'application/json');
  if (req.url.includes(':generateContent')) res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '图片描述' }] } }] }));
  else if (req.url.endsWith('/responses')) res.end(JSON.stringify({ output_text: '图片描述' }));
  else res.end(JSON.stringify({ choices: [{ message: { content: '图片描述' } }] }));
});

async function request(url, body, credential = internal.token()) {
  return fetch(base + url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(credential ? { 'X-WMD-Internal': credential } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  mockBase = 'http://127.0.0.1:' + mock.address().port;
  const registered = await request('/api/auth/register', { username: 'review', password: 'review-password' }, '');
  assert.equal(registered.status, 200);
});

test.after(async () => {
  server.closeAllConnections();
  mock.closeAllConnections();
  await Promise.all([new Promise((r) => server.close(r)), new Promise((r) => mock.close(r))]);
});

test('登录保护拒绝旧内部标头和伪造凭据，接受共享凭据与正常登录', async () => {
  for (const credential of ['', '1', 'invalid-token']) {
    assert.equal((await request('/api/state', undefined, credential)).status, 401);
  }
  assert.equal((await request('/api/state')).status, 200);
  const login = await request('/api/auth/login', { username: 'review', password: 'review-password' }, '');
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(base + '/api/state', { headers: { Cookie: cookie } })).status, 200);
  const state = await (await request('/api/state')).text();
  assert.ok(!state.includes(internal.token()), '内部凭据不能出现在界面状态中');
});

test('调整音量和静音保留主题收藏、音频，并能从新进程恢复', async () => {
  const saved = { theme: 'user-wp-test', wallpapers: [{ id: 'user-wp-test', path: 'test.mp4', kind: 'video' }], musicPath: 'song.mp3', musicVolume: 23, wallpaperSidebarDim: .7, conversationFolders: [{ id: 'folder-test', name: '校园短剧' }], conversationFolderMap: { sample: 'folder-test' }, agentWelcomeText: '让灵感成为作品。', agentFont: 'song', agentFontSize: 20, agentLineHeight: 2, agentTitleSize: 52, agentFontWeight: 500 };
  const put = async (ui) => {
    const response = await fetch(base + '/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-WMD-Internal': internal.token() }, body: JSON.stringify({ ui }) });
    assert.equal(response.status, 200);
    return (await response.json()).data.ui;
  };
  await put(saved);
  await put({ volume: 42 });
  const ui = await put({ muted: true });
  for (const [key, value] of Object.entries(saved)) assert.deepEqual(ui[key], value);
  const restored = JSON.parse(execFileSync(process.execPath, ['-e', "process.stdout.write(JSON.stringify(require('./src/config').load().ui))"], { cwd: path.join(__dirname, '..'), env: process.env, encoding: 'utf8' }));
  assert.deepEqual(restored, ui);
  assert.equal(restored.volume, 42);
  assert.equal(restored.muted, true);
  assert.deepEqual((await put({ wallpapers: [] })).wallpapers, []);
});

test('抽帧目录可读取，同时拒绝目录外的文件', async () => {
  const dir = path.join(config.DATA, 'frames', 'test');
  fs.mkdirSync(dir, { recursive: true });
  const frame = path.join(dir, 'frame.jpg');
  fs.writeFileSync(frame, 'frame');
  const response = await request('/api/file?path=' + encodeURIComponent(frame));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'frame');
  const outside = path.join(config.DATA, 'internal-token.json');
  assert.equal((await request('/api/file?path=' + encodeURIComponent(outside))).status, 403);
});

test('视频流式上传支持超过 60MB，拒绝超过 600MB', async () => {
  const { Readable } = require('node:stream');
  const size = 61 * 1024 * 1024;
  const response = await fetch(base + '/api/upload/raw?name=large.mp4', {
    method: 'POST', headers: { 'X-WMD-Internal': internal.token() }, duplex: 'half',
    body: Readable.from((async function* () {
      for (let i = 0; i < 61; i++) yield Buffer.alloc(1024 * 1024, i);
    })()),
  });
  assert.equal(response.status, 200);
  const saved = (await response.json()).data;
  assert.equal(saved.bytes, size);
  assert.equal(fs.statSync(saved.path).size, size);
  fs.unlinkSync(saved.path);
  const status = await new Promise((resolve, reject) => {
    const req = http.request(base + '/api/upload/raw?name=too-large.mp4', {
      method: 'POST', headers: { 'X-WMD-Internal': internal.token(), 'Content-Length': 600 * 1024 * 1024 + 1 },
    }, (res) => { res.resume(); resolve(res.statusCode); req.destroy(); });
    req.on('error', reject);
    req.flushHeaders();
  });
  assert.equal(status, 413);
});

test('内置真人动态照片支持视频 Range 请求', async () => {
  const response = await fetch(base + '/skins/real-cafe.mp4', { headers: { Range: 'bytes=0-127' } });
  assert.equal(response.status, 206);
  assert.match(response.headers.get('content-type'), /video\/mp4/);
  assert.match(response.headers.get('content-range'), /^bytes 0-127\//);
  assert.equal((await response.arrayBuffer()).byteLength, 128);
});

test('Python 创作工具使用同一数据目录的凭据访问 Node 服务', async (t) => {
  const python = process.env.WMD_PYTHON || 'D:/notebook/AIGC/ml-engineer/backend/.venv/Scripts/python.exe';
  if (!fs.existsSync(python)) return t.skip('未配置智能体 Python');
  const stdout = await new Promise((resolve, reject) => {
    execFile(python, ['-B', '-c', "from app.create_tools import _http; print(_http('GET', '/api/jobs')['stats']['total'])"], {
      cwd: path.join(__dirname, '..', 'agent_backend'),
      env: { ...process.env, WMD_BASE_URL: base, PYTHONDONTWRITEBYTECODE: '1' },
      windowsHide: true,
      timeout: 30000,
    }, (err, out, stderr) => err ? reject(new Error(stderr || err.message)) : resolve(out));
  });
  assert.equal(String(stdout).trim(), '0');
});

test('实际抽帧生成的预览 URL 可访问', async (t) => {
  const ffmpeg = process.env.WMD_FFMPEG || 'D:/notebook/software/ffmpeg/bin/ffmpeg.exe';
  const ffprobe = process.env.WMD_FFPROBE || 'D:/notebook/software/ffmpeg/bin/ffprobe.exe';
  if (!fs.existsSync(ffmpeg) || !fs.existsSync(ffprobe)) return t.skip('未配置 FFmpeg');
  const video = path.join(tmp, 'sample.mp4');
  execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=1', '-c:v', 'mpeg4', video], { windowsHide: true });
  const response = await (await request('/api/tools/frames', { path: video, count: 1, width: 320 })).json();
  assert.equal(response.ok, true, JSON.stringify(response));
  const frame = await request(response.data.frames[0].url);
  assert.equal(frame.status, 200);
  assert.ok((await frame.arrayBuffer()).byteLength > 0);
});

test('图片描述按渠道协议发送请求，包括 Responses 图片格式', async () => {
  const image = path.join(tmp, 'ref.png');
  fs.writeFileSync(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB1sAAAAASUVORK5CYII=', 'base64'));
  for (const type of ['openai-chat', 'gemini', 'openai-responses']) {
    const channel = channels.create('llm', { name: type, type, baseUrl: mockBase + '/v1', apiKey: 'mock', model: 'mock-vision' });
    channels.activate('llm', channel.id);
    const response = await (await request('/api/images/describe', { path: image })).json();
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.data.text, '图片描述');
    const sent = requests.at(-1);
    if (type === 'gemini') {
      assert.match(sent.path, /:generateContent$/);
      assert.ok(sent.body.contents[0].parts.some((p) => p.inline_data));
    } else if (type === 'openai-responses') {
      assert.match(sent.path, /\/responses$/);
      assert.ok(sent.body.input[0].content.some((p) => p.type === 'input_image'));
    } else assert.match(sent.path, /\/chat\/completions$/);
  }
});

test('队首渠道繁忙时仍启动其他渠道，并保持同渠道顺序', async (t) => {
  const workflows = require('../src/workflows');
  const generic = require('../src/generic-video');
  const originalGet = workflows.get, originalValidate = workflows.validate, originalSubmit = generic.submit;
  const pending = [];
  t.after(() => {
    workflows.get = originalGet;
    workflows.validate = originalValidate;
    generic.submit = originalSubmit;
    for (const reject of pending) reject(new Error('模拟结束'));
  });
  config.save({ concurrency: 3, channels: { llm: [], image: [], video: ['a', 'b'].map((id) => ({ id, type: 'generic-task', name: id, enabled: true })) } });
  workflows.get = (id) => ({ id, provider: 'generic', channelId: id });
  workflows.validate = () => ({ errors: [], warnings: [] });
  generic.submit = () => new Promise((resolve, reject) => pending.push(reject));
  const a1 = jobs.addJobs({ workflowId: 'a', prompt: 'a1' })[0];
  const a2 = jobs.addJobs({ workflowId: 'a', prompt: 'a2' })[0];
  const b1 = jobs.addJobs({ workflowId: 'b', prompt: 'b1' })[0];
  await new Promise(setImmediate);
  assert.equal(a1.status, 'running');
  assert.equal(a2.status, 'queued');
  assert.equal(b1.status, 'running');
  jobs.cancel(a2.id);
});
