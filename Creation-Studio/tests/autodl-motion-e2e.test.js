'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { startMockCloud, PNG } = require('./mock-cloud');

const PORT = 19371;
const ROOT = path.resolve(__dirname, '..');

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitFor(fn, timeoutMs = 40000, interval = 300) {
  const start = Date.now();
  for (;;) {
    try {
      const value = await fn();
      if (value) return value;
    } catch { /* retry */ }
    if (Date.now() - start > timeoutMs) throw new Error('等待超时');
    await sleep(interval);
  }
}

test('AutoDL 官方H3 渠道：动作迁移提交 → 轮询 → 下载', { timeout: 90000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmd-autodl-'));
  const mock = await startMockCloud();
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, APPDATA: path.join(tmp, 'appdata'), WMD_PORT: String(PORT), WMD_DATA_DIR: path.join(tmp, 'data'), WMD_AUTODL_BASE: mock.url },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const base = `http://127.0.0.1:${PORT}`;
  try {
    await waitFor(async () => (await fetch(base + '/api/health')).ok, 20000);
    const cfg = await fetch(base + '/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        autodlKeys: [], channels:{llm:[],image:[],video:[{id:'auto-test',type:'autodl-h3',name:'AutoDL 官方H3',baseUrl:mock.url,apiKey:'mock-token',enabled:true,active:true}]},
        saveFolder: path.join(tmp, 'media'),
        assetFolder: path.join(tmp, 'assets'),
      }),
    }).then((r) => r.json());
    assert.ok(cfg.ok, JSON.stringify(cfg));

    const channelResult=await fetch(base+'/api/channels',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'video',type:'autodl-h3',name:'AutoDL 官方H3',baseUrl:mock.url,apiKey:'mock-token'})}).then(r=>r.json());
    assert.ok(channelResult.ok,JSON.stringify(channelResult));
    const channelId=channelResult.data.id;
    const catalog=await fetch(base+'/api/state').then(r=>r.json());
    const official=catalog.data.workflows.filter(w=>w.channelId===channelId);
    assert.equal(official.length,5);
    assert.equal(official.find(w=>w.id.endsWith(':minimax_h3_lightx2v_v5')).durationOptions.at(-1),10);
    assert.equal(official.filter(w=>w.videos===1).length,1);
    const invalid=await fetch(base+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workflowId:'auto:'+channelId+':wan2.2animate-v4-motion_retargeting',images:[{path:'ignored'}],prompt:''})}).then(r=>r.json());
    assert.equal(invalid.ok,false);assert.match(invalid.error,/动作参考视频/);

    const upload = await fetch(base + '/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'a.png', data: 'data:image/png;base64,' + PNG.toString('base64') }),
    }).then((r) => r.json());
    assert.ok(upload.ok);

    const prompt = `subject_definitions:
<Subject 1> is A from <Picture 1>.
summary:
[reference generation] Test.
retention_analysis:
<Subject 1> (appears in [Shot 1]): fully_preserved - face.
detailed_description:
[Shot 1] A wide shot of <Subject 1>.
overall_soundscape:
Wind.
non_diegetic_music:
N/A`;

    fs.writeFileSync(path.join(tmp,'motion.mp4'),Buffer.from('test-video'));
    const created = await fetch(base + '/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId: 'auto:'+channelId+':wan2.2animate-v4-motion_retargeting',
        prompt: '',
        images: [{ path: upload.data.path, name: upload.data.name }],
        audios: [],
        videos:[{path:path.join(tmp,'motion.mp4'),name:'motion.mp4'}],
        duration: 10,
        resolution: '464*832px(竖版)',
        count: 1,
      }),
    }).then((r) => r.json());
    assert.ok(created.ok, JSON.stringify(created));
    const jobId = created.data.jobs[0].id;

    const job = await waitFor(async () => {
      const list = await fetch(base + '/api/jobs').then((r) => r.json());
      const hit = list.data.jobs.find((j) => j.id === jobId);
      return hit && (hit.status === 'success' || hit.status === 'failed') ? hit : null;
    }, 45000);
    assert.equal(job.status, 'success', job.error || '');
    assert.equal(job.remotePromptId, 'mock-task-1');
    assert.ok(job.outputs.some((o) => o.type === 'video' && fs.existsSync(o.path)));

    const submit = mock.state.submits.find((s) => s.workflowId);
    assert.ok(submit, '没有提交请求');
    assert.equal(submit.workflowId, 'wan2.2animate-v4-motion_retargeting');
    assert.equal(mock.state.auth, 'Bearer mock-token');
    assert.equal(submit.body.resolution, '464*832px(竖版)');
    assert.equal(submit.body.duration, undefined);assert.equal(submit.body.prompt,undefined);
    assert.match(submit.body.ref_video,/^data:video\/mp4;base64,/);
    assert.ok(Number.isFinite(submit.body.seed));
    assert.match(submit.body.ref_image, /^data:image\/png;base64,/);

  } finally {
    child.kill();
    mock.server.close();
    await sleep(300);
  }
});
