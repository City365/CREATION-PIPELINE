'use strict';
// 序列化进豆包对话页执行：只收集当前 DOM 里已经渲染出来的视频消息。
// 这个函数不能引用外部变量，也不能 require；它由 page.evaluate 直接注入页面。
function scanConversationVideos(options = {}) {
  const limit = Math.max(1, Math.min(200, Number(options && options.limit) || 80));
  const norm = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const isHttp = (value) => /^https?:\/\//i.test(String(value || ''));
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const roleOf = (el) => {
    const tag = (el.getAttribute('data-role') || el.getAttribute('data-message-role') || el.className || '').toString();
    if (/(?:^|[ _-])user(?:$|[ _-])/i.test(tag)) return 'user';
    if (/assistant|(?:^|[ _-])bot(?:$|[ _-])|receive_message/i.test(tag)) return 'assistant';
    return 'unknown';
  };
  const mediaSelector = 'video, video source, [data-no-watermark-url], [data-video-url], a[href]';
  const collected = [];
  const seen = new Set();
  const add = (record) => {
    if (!record || !isHttp(record.url) || seen.has(record.url) || collected.length >= limit) return;
    seen.add(record.url);
    collected.push(record);
  };
  const readMedia = (element, messageId, role, text) => {
    const node = element.tagName === 'SOURCE' ? element.parentElement : element;
    const raw = element.getAttribute('data-no-watermark-url') || element.getAttribute('data-video-url')
      || (element.tagName === 'VIDEO' ? (element.currentSrc || element.getAttribute('src') || '') : (element.href || ''));
    if (!raw) return;
    const url = String(raw);
    if (element.tagName === 'A' && !/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)) return;
    const video = node && node.tagName === 'VIDEO' ? node : null;
    add({
      messageId: String(messageId || ''),
      role,
      url,
      kind: element.tagName.toLowerCase(),
      confirmedNoWatermark: Boolean(element.getAttribute('data-no-watermark-url')) || element.getAttribute('data-watermark') === 'false',
      ready: video ? video.readyState >= 1 && Number.isFinite(video.duration) && video.duration > 0 : true,
      duration: video && Number.isFinite(video.duration) ? video.duration : null,
      width: video ? video.videoWidth || null : null,
      height: video ? video.videoHeight || null : null,
      poster: video ? video.getAttribute('poster') || '' : '',
      text: norm(text).slice(0, 160),
    });
  };
  const nodes = [...document.querySelectorAll('[data-message-id]')];
  const roots = nodes.filter((node) => !nodes.some((other) => other !== node && node.contains(other)));
  for (const root of roots) {
    const id = String(root.getAttribute('data-message-id') || '');
    const role = roleOf(root);
    const text = norm(root.innerText || root.textContent || '');
    for (const element of root.querySelectorAll(mediaSelector)) readMedia(element, id, role, text);
    if (root.querySelector('video') === null && /视频生成|生成视频|video/i.test(text)) {
      // 还没有视频的消息也记一条消息摘要，方便界面提示「这条还在生成」。
    }
  }
  // 兜底：不在消息容器里的视频（例如全屏预览层），仍然给出地址，但归属未知。
  for (const video of document.querySelectorAll('video')) {
    const raw = video.currentSrc || video.getAttribute('src') || '';
    if (!raw) continue;
    const host = video.closest('[data-message-id]');
    readMedia(video, host ? host.getAttribute('data-message-id') : '', host ? roleOf(host) : 'unknown', '');
  }
  const captchaSelector = 'iframe[src*="captcha"], [id*="captcha_container"], [class*="captcha-verify"], [data-testid="captcha"]';
  return {
    pageUrl: location.href,
    title: document.title,
    messageCount: nodes.length,
    generating: Boolean(document.querySelector('[data-testid="chat_input_stop_button"], [data-testid="chat_input_stop_generate_button"]')),
    captcha: [...document.querySelectorAll(captchaSelector)].some(visible),
    videos: collected,
  };
}
module.exports = { scanConversationVideos };
