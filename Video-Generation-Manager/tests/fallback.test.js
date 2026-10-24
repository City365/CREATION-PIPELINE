'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const {
  decodeMainUrl,
  resolvePayload,
  unwatermarkedRequest,
  hasWatermark,
  parseJSON,
  collectFallbacks,
  attachFallbackCapture,
  resolveFallbackVideo
} = require('../src/adapters/doubao-fallback');

test('fallback参数、长消息ID和嵌套JSON按消息关联', () => {
  const url = new URL(unwatermarkedRequest('https://www.doubao.com/video/info?token=abc&logo_type=old'));
  assert.equal(url.searchParams.get('token'), 'abc');
  assert.equal(url.searchParams.get('logo_type'), 'unwatermarked');
  assert.equal(url.searchParams.get('channel'), 'no');
  assert.equal(url.searchParams.get('codec_type'), '8');
  assert.throws(() => unwatermarkedRequest('https://localhost/video'));
  const parsed = parseJSON('{"message_id":59333689176907010,"content":"{\\"fallback_api\\":\\"https://www.doubao.com/video/info?x=1\\"}"}');
  assert.equal(parsed.message_id, '59333689176907010');
  assert.deepEqual(collectFallbacks(parsed), [{ messageId: '59333689176907010', url: 'https://www.doubao.com/video/info?x=1' }]);
});

test('解码普通Base64与使用key_seed派生密钥的qAAB加密地址', async () => {
  const url = 'https://v26-videoweb.doubao.com/video/original.mp4?test=1';
  assert.equal(await decodeMainUrl(Buffer.from(url).toString('base64')), url);
  const seed = Buffer.alloc(32, 7);
  const digest = await webcrypto.subtle.digest('SHA-512', seed);
  const salt = Buffer.from('4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58', 'hex');
  const second = Buffer.from(await webcrypto.subtle.digest('SHA-512', Buffer.concat([Buffer.from(digest), salt])));
  const key = await webcrypto.subtle.importKey('raw', second.subarray(0, 16), 'AES-CBC', false, ['encrypt']);
  const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-CBC', iv: second.subarray(16, 32) }, key, Buffer.from(url));
  const token = Buffer.concat([Buffer.from([0xa8, 0, 1, 0]), Buffer.from(encrypted)]).toString('base64');
  assert.ok(token.startsWith('qAAB'));
  assert.equal(await decodeMainUrl(token, seed.toString('base64')), url);
  assert.equal(await decodeMainUrl(token, Buffer.alloc(32, 8).toString('base64')), '');
});

test('不会将带动态水印的视频作为无水印结果，优先选择可解码清晰视频', async () => {
  assert.equal(hasWatermark('https://x/video?lr=video_gen_watermark_dyn'), true);
  assert.equal(await resolvePayload({ video_info: { data: { video_list: { v: { main_url: 'https://x/video?lr=video_gen_watermark_dyn' } } } } }), null);
  const url = 'https://x/video.mp4';
  const result = await resolvePayload({ video_info: { data: { video_list: {
    high: { main_url: Buffer.from(url).toString('base64'), vwidth: 1280, vheight: 720 },
    bad: { main_url: 'not-a-url', vwidth: 1920, vheight: 1080 }
  } } } });
  assert.equal(result.url, url);
  assert.equal(result.height, 720);
});

test('实测主机vas-lf-x.snssdk.com可用，历史会话batch_get也会被采集', async () => {
  const accepted = new URL(unwatermarkedRequest('https://vas-lf-x.snssdk.com/video/fplay/1/abc/v0?aid=482431&key_seed=xyz&logo_type=video_gen_watermark_dyn'));
  assert.equal(accepted.hostname, 'vas-lf-x.snssdk.com');
  assert.equal(accepted.searchParams.get('logo_type'), 'unwatermarked');
  assert.throws(() => unwatermarkedRequest('https://example.com/video'));

  const listeners = {};
  const page = {
    on(name, fn) { listeners[name] = fn; },
    evaluate: async () => [{ messageId: '123456789', url: 'https://vas-lf-x.snssdk.com/video/fplay/1/abc/v0?key_seed=xyz' }]
  };
  attachFallbackCapture(page);
  assert.equal(typeof listeners.response, 'function');
  const decoded = Buffer.from('https://v26-videoweb.doubao.com/video/a.mp4').toString('base64');
  const body = JSON.stringify({ downlink_body: { messages: [{
    message_id_str: '123456789',
    content: JSON.stringify({ creation_block: { creations: [{ video: { video_model: JSON.stringify({
      fallback_api: 'https://vas-lf-x.snssdk.com/video/fplay/1/abc/v0?key_seed=xyz',
      video_list: { v: { main_url: decoded } }
    }) } }] } })
  }] } });
  listeners.response({ url: 'https://www.doubao.com/im/conversation/batch_get', text: async () => body });
  const request = async () => ({ ok: true, status: 200, json: async () => ({ video_info: { data: { video_list: { v: { main_url: decoded } } } } }) });
  const result = await resolveFallbackVideo({ page, messageIds: ['123456789'], request });
  assert.equal(result.url, 'https://v26-videoweb.doubao.com/video/a.mp4');
  assert.equal(result.messageId, '123456789');
});

test('只请求当前消息的fallback，缓存成功结果并遵守取消信号', async () => {
  let calls = 0;
  const page = {
    on() {},
    evaluate: async () => [
      { messageId: '123456789', url: 'https://www.doubao.com/fallback?secret=a' },
      { messageId: '987654321', url: 'https://www.doubao.com/other' }
    ]
  };
  const request = async (url, opts) => {
    calls += 1;
    assert.equal(new URL(url).pathname, '/fallback');
    assert.equal(new URL(url).searchParams.get('logo_type'), 'unwatermarked');
    assert.equal(opts.headers.Cookie, undefined);
    return { ok: true, status: 200, json: async () => ({ video_info: { data: { video_list: {
      v: { main_url: Buffer.from('https://v26-videoweb.doubao.com/video/a.mp4').toString('base64') }
    } } } }) };
  };
  const input = { page, messageIds: ['123456789'], signal: new AbortController().signal, request };
  const result = await resolveFallbackVideo(input);
  assert.equal(result.messageId, '123456789');
  await resolveFallbackVideo(input);
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(resolveFallbackVideo({ ...input, signal: controller.signal }));
});
