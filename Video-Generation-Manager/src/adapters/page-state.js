'use strict';
// This function is serialized into Chrome. Keep it independent of Node imports.
function readPageState({ selectors = {}, baseline = [], prompt = '', anchorKey = '' } = {}) {
  const defaults = {
    message: '[data-message-id], [data-role="user"], [data-role="assistant"], [data-message-role], [data-testid="user_message"], [data-testid="assistant_message"]',
    userMessage: '[data-role="user"], [data-message-role="user"], [data-testid="user_message"], [data-testid="send_message"], [class*="message-user"]',
    assistantMessage: '[data-role="assistant"], [data-message-role="assistant"], [data-testid="assistant_message"], [data-testid="receive_message"], [class*="message-assistant"]',
    captcha: 'iframe[src*="captcha"], [id*="captcha_container"], [class*="captcha-verify"], [data-testid="captcha"]',
  };
  const config = { ...defaults, ...selectors };
  const visible = e => { const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0 && r.height>0 && s.visibility!=='hidden' && s.display!=='none'; };
  const normalize = s => String(s || '').replace(/\s+/g,' ').trim();
  const compact=s=>String(s||'').replace(/\s+/g,'');
  const matchesPrompt=(text,expected)=>{
    const actual=compact(text),wanted=compact(expected);
    if(actual===wanted)return true;
    const suffix=/^[,，]*(?:(?:\d+:\d+|\d+s|\d+p)[,，]*)*$/;
    return [wanted,'生成视频：'+wanted].some(prefix=>actual.startsWith(prefix)&&suffix.test(actual.slice(prefix.length)));
  };
  const before = new Set(baseline);
  const all = [...new Set(document.querySelectorAll([config.message,config.userMessage,config.assistantMessage].filter(Boolean).join(',')))];
  const elements = all.filter(e=>!all.some(parent=>parent!==e&&parent.contains(e)&&(parent.matches(config.userMessage)||parent.matches(config.assistantMessage))));
  const messages = elements.map(e => {
    const key = e.dataset.localManagerMessageKey ||= crypto.randomUUID();
    const tag = (e.getAttribute('data-role') || e.getAttribute('data-message-role') || e.className || '').toString();
    const role = e.matches(config.userMessage) || /(?:^|[ _-])user(?:$|[ _-])/i.test(tag) ? 'user' :
      e.matches(config.assistantMessage) || /assistant|(?:^|[ _-])bot(?:$|[ _-])/i.test(tag) ? 'assistant' : 'unknown';
    const content=[...e.querySelectorAll('[data-testid="message_text_content"]')].map(n=>n.textContent).join('\n');
    const attachmentOnly=role==='user' && !normalize(content || e.innerText || e.textContent) && Boolean(e.querySelector('img, video, [data-testid="attachment-image-card"]'));
    return { e, key, role, attachmentOnly, text:normalize(content || e.innerText || e.textContent), id:String(e.getAttribute('data-message-id') || e.querySelector('[data-message-id]')?.getAttribute('data-message-id') || '') };
  });
  let anchor = messages.find(m => m.key === anchorKey);
  if (!anchor && prompt) anchor = messages.find(m => !before.has(m.key) && m.role === 'user' && matchesPrompt(m.text,prompt));
  if(anchor && prompt) window.__LOCAL_MANAGER_ANCHOR__={key:anchor.key,prompt:normalize(prompt),id:anchor.id,element:anchor.e};
  const cached=window.__LOCAL_MANAGER_ANCHOR__;
  if(!anchor && anchorKey && cached?.key===anchorKey && cached.prompt===normalize(prompt)) anchor={key:cached.key,id:cached.id,e:cached.element};
  const otherUser=anchor && messages.some(m=>m.role==='user'&&!before.has(m.key)&&m.key!==anchor.key&&!(m.attachmentOnly && Boolean(m.e.compareDocumentPosition(anchor.e) & Node.DOCUMENT_POSITION_FOLLOWING))&&!matchesPrompt(m.text,prompt)&&!['生成视频','确认，开始生成视频'].includes(m.text));
  const replies = anchor && !otherUser ? messages.filter(m => m.role==='assistant' && !before.has(m.key) && !anchor.e.contains(m.e)
    && (!anchor.e.isConnected || Boolean(anchor.e.compareDocumentPosition(m.e) & Node.DOCUMENT_POSITION_FOLLOWING))) : [];
  const media = [];
  for (const m of replies) for (const e of m.e.querySelectorAll('video, video source, a[href], [data-video-url], [data-no-watermark-url]')) {
    const url = e.getAttribute('data-no-watermark-url') || e.getAttribute('data-video-url') || e.currentSrc || e.src || e.href || '';
    if (!url || !/^(https?:|blob:)/.test(url)) continue;
    if (e.tagName==='A' && !/\.(mp4|webm)(\?|$)/i.test(url)) continue;
    media.push({ url, messageKey:m.key, messageId:m.id,
      confirmedNoWatermark:Boolean(e.getAttribute('data-no-watermark-url')) || e.getAttribute('data-watermark') === 'false',
      ready:e.tagName==='VIDEO' ? e.readyState>=1 && Number.isFinite(e.duration) && e.duration>0 : true });
  }
  const text = replies.map(m=>m.text).join('\n');
  return { keys:messages.map(m=>m.key), messageCount:messages.length, userKey:anchor?.key || '', userId:anchor?.id || '', otherUser:Boolean(otherUser),
    failedSend:Boolean(document.querySelector('[data-testid="message_box_failed_icon"]')), pendingConversation:/\/chat\/local_/.test(location.pathname),
    replies:replies.map(m=>({key:m.key,id:m.id,text:m.text})), text, media,
    captcha:[...document.querySelectorAll(config.captcha)].some(visible),
    confirmationSent:messages.some(m=>m.role==='user'&&['生成视频','确认，开始生成视频'].includes(m.text)),
    generating:/预计等待.{0,12}分钟|视频生成好后|本次生成将消耗|视频生成中|正在生成视频|排队中|生成任务已提交|generating video|in queue/i.test(text),
    complete:/视频生成好了|视频生成完成|视频已生成|video is ready|video generated/i.test(text),
    quota:/额度用完|今日次数.*上限|额度不足|daily limit|quota exceeded/i.test(text),
    failure:/出了点问题|视频生成失败|服务异常|生成失败|generation failed/i.test(text),
    refusal:/无法.*(?:生成|提供).*(?:侵权|违规|版权)|违反.*(?:政策|规定)|content policy/i.test(text),
    responding:Boolean(document.querySelector('[data-testid="chat_input_stop_button"], [data-testid="chat_input_stop_generate_button"]')),
    confirmation:/确认后.*生成|是否.*开始生成|即将生成|我将.*生成|confirm.*generat/i.test(text),
  };
}
module.exports = { readPageState };
