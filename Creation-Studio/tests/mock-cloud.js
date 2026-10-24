'use strict';
const http = require('node:http');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
const MP4 = Buffer.concat([Buffer.from('000000206674797069736f6d0000020069736f6d', 'hex'), Buffer.alloc(2048, 0x11)]);

function startMockCloud() {
  const state = {
    submits: [],
    histories: new Map(),
    auth: '',
    imageRequests: [],
    videoRequests: [],
    taskRequests: [],
    chatRequests: [],
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (code, payload, type = 'application/json') => {
      const body = Buffer.isBuffer(payload) ? payload : Buffer.from(JSON.stringify(payload));
      res.writeHead(code, { 'Content-Type': type, 'Content-Length': body.length });
      res.end(body);
    };
    const readJson = (cb) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(raw || '{}'); } catch { body = {}; }
        cb(body, raw);
      });
    };

    // OpenAI-compatible image generation
    if (url.pathname.endsWith('/images/generations') || url.pathname.endsWith('/images/edits')) {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        const ct = req.headers['content-type'] || '';
        let body = null;
        if (/json/i.test(ct)) { try { body = JSON.parse(raw); } catch { /* ignore */ } }
        state.imageRequests.push({ path: url.pathname, bytes: raw.length, contentType: ct, body });
        send(200, { created: 1, data: [{ b64_json: PNG.toString('base64') }] });
      });
      return;
    }
    if (url.pathname.endsWith('/models')) {
      return send(200, { data: [{ id: 'mock-model' }, { id: 'mock-image-model' }] });
    }

    // OpenAI-compatible video (Sora style)
    if (url.pathname.endsWith('/videos') && req.method === 'POST') {
      return readJson((body) => {
        state.videoRequests.push(body);
        send(200, { id: 'vid-1', status: 'queued' });
      });
    }
    if (/\/videos\/vid-1\/content$/.test(url.pathname)) return send(200, MP4, 'video/mp4');
    if (/\/videos\/vid-1$/.test(url.pathname)) {
      return send(200, { id: 'vid-1', status: 'completed', url: `http://127.0.0.1:${server.address().port}/output/mock-result.mp4` });
    }

    // Generic task-style video
    if (url.pathname.endsWith('/tasks') && req.method === 'POST') {
      return readJson((body) => {
        state.taskRequests.push(body);
        send(200, { code: 0, data: { task_id: 'task-1' } });
      });
    }
    if (/\/tasks\/task-1$/.test(url.pathname)) {
      return send(200, { code: 0, data: { status: 'SUCCEEDED', result: { video_url: `http://127.0.0.1:${server.address().port}/output/mock-result.mp4` } } });
    }

    if (url.pathname === '/output/mock-result.mp4') return send(200, MP4, 'video/mp4');

    // OpenAI Chat Completions (Skill 优化 / 图像反推)
    if (url.pathname.endsWith('/chat/completions')) {
      return readJson((body) => {
        state.chatRequests.push(body);
        const system = String((body.messages && body.messages[0] && body.messages[0].content) || '');
        let content;
        if (system.includes('Reverse-engineer')) content = 'A cinematic photo of a warrior monk by a summer lake, soft daylight, 35mm --ar 9:16';
        else if (system.includes('image prompt engineer')) content = 'A detailed cinematic portrait of a warrior monk, golden hour, shallow depth of field';
        else content = JSON.stringify({
          subject_definitions: ['<Subject 1> is the warrior monk from <Picture 1>, with a beard.'],
          summary: '[reference generation] A ten-second test scene with two characters.',
          retention_analysis: ['<Subject 1> (appears in [Shot 1]): fully_preserved - beard and robe.'],
          detailed_description: '[Shot 1] A wide shot of <Subject 1> standing at the lake. [Shot 2] At 00:04.000, cut to a close-up.',
          overall_soundscape: 'Wind and water.',
          non_diegetic_music: 'N/A',
        });
        send(200, { choices: [{ message: { role: 'assistant', content } }], model: body.model, usage: { total_tokens: 100 } });
      });
    }

    // AutoDL official workflow API
    if (url.pathname.startsWith('/api/v1/comfyui/comfyui_workflow/result/')) {
      const taskId = decodeURIComponent(url.pathname.split('/').pop());
      if (taskId === 'h3-key-check') return send(200, { code: 'success', data: { status: 'SUCCESS' } });
      const count = state.histories.get(taskId) || 0;
      state.histories.set(taskId, count + 1);
      if (count < 1) return send(200, { code: 'success', data: { status: 'QUEUED' } });
      if (count < 2) return send(200, { code: 'success', data: { status: 'RUNNING' } });
      return send(200, { code: 'success', data: { status: 'SUCCESS', video_url: `http://127.0.0.1:${server.address().port}/output/mock-result.mp4` } });
    }
    if (url.pathname.startsWith('/api/v1/comfyui/comfyui_workflow/')) {
      return readJson((body) => {
        state.auth = req.headers.authorization || '';
        const workflowId = decodeURIComponent(url.pathname.split('/').pop());
        const taskId = 'mock-task-' + (state.submits.length + 1);
        state.submits.push({ promptId: taskId, workflowId, body });
        state.histories.set(taskId, 0);
        send(200, { code: 'success', data: { task_id: taskId } });
      });
    }

    return send(404, { error: 'not found ' + url.pathname });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port, url: `http://127.0.0.1:${port}`, state });
    });
  });
}

module.exports = { startMockCloud, PNG, MP4 };
