'use strict';
/**
 * 为每套风格生成一张预览图（16:9 概念图），存到 data/styles/images/preview-*.png，
 * 并更新 data/styles.json 的 image / previewPrompt 字段。
 *
 *   node evidence/gen-style-previews.cjs [--limit=1]
 *
 * 需要先起一个创作台实例（默认 17821，临时库），并已注册 stylegen/test123。
 */
const fs = require('node:fs');
const path = require('node:path');

const BASE = (process.env.WMD_BASE || 'http://127.0.0.1:17821').replace(/\/+$/, '');
const STYLES = process.env.WMD_STYLES || path.join(__dirname, '..', 'data', 'styles.json');
const OUT_DIR = process.env.WMD_STYLE_IMAGE_DIR || path.join(__dirname, '..', 'data', 'styles', 'images');
const LIMIT = Number((process.argv.find((x) => x.startsWith('--limit=')) || '').split('=')[1] || 0);

let cookie = '';
async function call(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...(opts.headers || {}),
    },
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(path + ': ' + (data.error || res.status));
  return data.data;
}

function promptFor(style) {
  const summary = String(style.video || style.summary || '').replace(/\s+/g, ' ').slice(0, 420);
  return [
    '风格预览图：' + style.name + '。',
    summary,
    '要求：单幅 16:9 横版电影感概念图，完整呈现这套风格的光线、色彩、材质与氛围；画面干净、单一场景；',
    '不要文字、字幕、水印、logo、网格、拼图、分镜排版，不要出现多格拼接。',
  ].join(' ');
}

(async () => {
  const user = process.env.WMD_USER || 'stylegen';
  const pass = process.env.WMD_PASS || 'test123';
  try {
    await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: user, password: pass }) });
  } catch (err) {
    console.log('login skipped:', err.message.slice(0, 60));
  }
  const state = await call('/api/state');
  const channel = (state.channels.image || []).find((c) => c.enabled !== false);
  if (!channel) throw new Error('没有可用的图像渠道');
  const styles = JSON.parse(fs.readFileSync(STYLES, 'utf8'));
  const targets = LIMIT ? styles.slice(0, LIMIT) : styles;
  for (const style of targets) {
    if (!process.argv.includes('--force') && String(style.image || '').startsWith('data/styles/images/preview-')) {
      console.log('skip', style.id, style.name);
      continue;
    }
    const prompt = promptFor(style);
    console.log('generating', style.id, style.name);
    let data;
    try {
      data = await call('/api/images/generate', {
        method: 'POST',
        body: JSON.stringify({ channelId: channel.id, prompt, count: 1, size: '1536x1024', quality: 'auto' }),
      });
    } catch (err) {
      console.log('retry with softer prompt:', err.message.slice(0, 80));
      const soft = '原创虚构角色与场景的风格概念图：' + style.name + '。' + String(style.summary || '').slice(0, 80)
        + ' 单幅 16:9 电影感画面，展示该风格的光线、色彩与质感；不要文字、水印、logo、拼图。';
      data = await call('/api/images/generate', {
        method: 'POST',
        body: JSON.stringify({ channelId: channel.id, prompt: soft, count: 1, size: '1536x1024', quality: 'auto' }),
      });
      style.previewPrompt = soft;
    }
    const item = (data.items || [])[0];
    if (!item) throw new Error('没有返回图片');
    const saved = await call('/api/images/save-copy', {
      method: 'POST',
      body: JSON.stringify({ paths: [item.path], name: 'preview-' + style.id + '.png', target: 'custom', dir: OUT_DIR }),
    });
    style.image = 'data/styles/images/' + saved.items[0].name;
    style.previewPrompt = prompt;
    console.log('saved', style.image, saved.items[0].bytes);
    fs.writeFileSync(STYLES, JSON.stringify(styles, null, 2) + '\n', 'utf8');
  }
  console.log('done', targets.length);
})();
