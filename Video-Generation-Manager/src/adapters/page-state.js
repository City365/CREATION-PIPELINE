'use strict';
// This function is serialized into Chrome. Keep it independent of Node imports.
function readPageState({ selectors = {}, baseline = [], prompt = '', anchorKey = '', attachments = 0, taskReplies = [], confirmReplies = [] } = {}) {
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
  const stripTaskPrefix=s=>String(s||'').replace(/^生成视频[：:]\s*/,'');
  // 平台会给自己发出的消息加参数后缀（16:9 / 15s / 720p），确认话术也可能被这样改写。
  const stripParamSuffix=s=>String(s||'').replace(/[,，]*(?:(?:\d+:\d+|\d+s|\d+p)[,，]*)+$/,'');
  const replyKey=s=>stripParamSuffix(compact(stripTaskPrefix(s))).replace(/[，,。.!！?？、\s]/g,'');
  const replySet=new Set((Array.isArray(taskReplies)?taskReplies:[]).map(replyKey));
  const confirmSet=new Set((Array.isArray(confirmReplies)?confirmReplies:[]).map(replyKey));
  // Video mode rewrites typed text (prefix "生成视频：" and a parameter suffix).
  // Confirmation replies therefore must be recognised after that rewrite too.
  const isConfirmationReply=s=>{const t=replyKey(s);return t==='确认生成视频'||t==='确认开始生成视频'||confirmSet.has(t);};
  const isTaskReply=s=>{const t=replyKey(s);return t==='生成视频'||isConfirmationReply(s)||replySet.has(t)||/^取消[，,]?(?:视频生成任务|生成任务|视频生成)$/.test(t);};
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
  if (!anchor && prompt) {
    // Native reference binding replaces <Picture N> with the file name chips, so the
    // rendered text can differ from the submitted prompt. Accept the single fresh
    // user message (attachment-only bubbles and task replies excluded) as the anchor.
    const fresh = messages.filter(m=>!before.has(m.key) && m.role==='user' && !m.attachmentOnly && !isTaskReply(m.text));
    anchor = fresh.find(m=>matchesPrompt(m.text,prompt)) || (fresh.length===1?fresh[0]:undefined);
  }
  if(anchor && prompt) window.__LOCAL_MANAGER_ANCHOR__={key:anchor.key,prompt:normalize(prompt),id:anchor.id,element:anchor.e};
  const cached=window.__LOCAL_MANAGER_ANCHOR__;
  if(!anchor && anchorKey && cached?.key===anchorKey && cached.prompt===normalize(prompt)) anchor={key:cached.key,id:cached.id,e:cached.element};
  const anchorIndex = anchor ? messages.indexOf(anchor) : -1;
  // Doubao may render our own attachments as a separate picture-only bubble next to
  // the prompt (order varies), and that bubble can still be empty when the check runs
  // (images not painted yet). Such a bubble belongs to this submission, never to
  // another user, as long as the task actually uploaded references.
  const ownAttachment = m => m.role === 'user' && Boolean(anchor) && (m.attachmentOnly || !normalize(m.text)) && (
    Boolean(m.e.compareDocumentPosition(anchor.e) & Node.DOCUMENT_POSITION_FOLLOWING)
    || (attachments > 0 && anchorIndex >= 0 && Math.abs(messages.indexOf(m) - anchorIndex) === 1));
  const otherUser=anchor && messages.some(m=>m.role==='user'&&!before.has(m.key)&&m.key!==anchor.key&&!ownAttachment(m)&&!matchesPrompt(m.text,prompt)&&!isTaskReply(m.text));
  // 任务执行不再因为会话里出现额外用户消息而停止（只保留 otherUser 标记供测试页参考）。
  const replies = anchor ? messages.filter(m => m.role==='assistant' && !before.has(m.key) && !anchor.e.contains(m.e)
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
  const lastText = replies.length ? replies[replies.length-1].text : '';
  return { keys:messages.map(m=>m.key), messageCount:messages.length, userKey:anchor?.key || '', userId:anchor?.id || '', otherUser:Boolean(otherUser),
    messages:messages.map(m=>({role:m.role,key:m.key,id:m.id,attachmentOnly:m.attachmentOnly,text:m.text.slice(0,160)})),
    failedSend:Boolean(document.querySelector('[data-testid="message_box_failed_icon"]')), pendingConversation:/\/chat\/local_/.test(location.pathname),
    replies:replies.map(m=>({key:m.key,id:m.id,text:m.text})), text, media,
    captcha:[...document.querySelectorAll(config.captcha)].some(visible),
    confirmationSent:messages.some(m=>m.role==='user'&&isConfirmationReply(m.text)),
    generating:/预计等待.{0,12}分钟|视频生成好后|本次生成将消耗|视频生成中|正在生成视频|排队中|生成任务已提交|generating video|in queue/i.test(text),
    complete:/视频生成好了|视频生成完成|视频已生成|video is ready|video generated/i.test(text),
    canceled:/(?:已经?|已)(?:帮你)?取消[^。\n]{0,40}(?:视频生成|生成任务)|视频生成[^。\n]{0,12}已取消|取消(?:视频)?生成成功|不会消耗额度/i.test(text),
    quota:/额度用完|今日次数.*上限|额度不足|daily limit|quota exceeded/i.test(text),
    failure:/出了点问题|视频生成失败|服务异常|生成失败|generation failed/i.test(text),
    refusal:/无法.*(?:生成|提供).*(?:侵权|违规|版权)|违反.*(?:政策|规定)|content policy/i.test(text),
    // 平台有时先回复“暂时不能生成视频”来验证真人，需要继续请求 2-3 轮才会进入确认生成。
    videoUnavailable:/(?:我|这边|目前|暂时|现在)[^。\n]{0,10}(?:无法|不能|没法|不支持|不可以|没办法)[^。\n]{0,12}(?:生成|制作|创作|做)[^。\n]{0,6}(?:视频|短片)|(?:我|这边|目前|暂时|现在)[^。\n]{0,10}(?:无法|不能|没法)[^。\n]{0,6}直接[^。\n]{0,4}(?:生成|制作|创作)|不支持[^。\n]{0,6}(?:视频生成|生成视频)|(?:视频生成|生成视频)[^。\n]{0,8}(?:暂不可用|暂时不可用|无法使用|不支持|已关闭)|(?:只能|仅能)[^。\n]{0,10}(?:提供|给出)[^。\n]{0,8}(?:文字|脚本|方案)[^。\n]{0,8}(?:无法|不能)[^。\n]{0,6}(?:生成|制作)[^。\n]{0,4}视频/i.test(lastText),
    responding:Boolean(document.querySelector('[data-testid="chat_input_stop_button"], [data-testid="chat_input_stop_generate_button"]')),
    confirmation:/确认后.*生成|是否.*开始生成|即将生成|我将.*生成|confirm.*generat/i.test(text),
  };
}
module.exports = { readPageState };
