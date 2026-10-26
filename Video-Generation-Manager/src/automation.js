'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: wait } = require('node:timers/promises');
const { readPageState } = require('./adapters/page-state');
const { readAttachmentState } = require('./adapters/attachment-state');
const { downloadVideo } = require('./download');
const {resolveFallbackVideo}=require('./adapters/doubao-fallback');
const resolver = fs.readFileSync(path.join(__dirname,'adapters','doubao-official-resolver.js'),'utf8');
// 豆包页面的默认选择器：账号没单独配置时也要能跑，不能因为换了账号就报“未配置选择器”。
// 账号高级设置里的值优先覆盖这里。
const DOUBAO_DEFAULTS={
  editor:'[data-testid="chat_input_input"] [contenteditable="true"]',
  send:'[data-testid="chat_input_send_button"]',
  newChat:'[role="button"]:has-text("新对话")',
  upload:'input[data-testid="upload-file-input"]',
  attachment:'[data-testid="attachment-image-card"]',
  modeControl:'[data-testid="skill_bar_button_17"]',
  modelControl:'[data-input-engine-actionbar-control-key="video-model"]',
  durationControl:'[data-input-engine-actionbar-render-entry-key="video-generation-params-panel"]',
  ratioControl:'[data-input-engine-actionbar-render-entry-key="video-generation-params-panel"]',
};
function selectorsFor(platform, account={}){
  return {...(platform==='doubao'?DOUBAO_DEFAULTS:{}), ...(account.selectors||{})};
}
async function firstVisible(page, selector, timeout=15000) {
  const end=Date.now()+timeout;
  while(Date.now()<end) {
    const locator=page.locator(selector); const count=await locator.count();
    for(let i=0;i<count;i++) if(await locator.nth(i).isVisible()) return locator.nth(i);
    await wait(200);
  }
  throw new Error('找不到页面控件，请先登录或在账号高级设置中更新选择器：'+selector);
}
async function applyOptions(page, task, selectors, signal) {
  const proof={requested:{model:task.model||'',ratio:task.ratio||'',duration:task.duration??null,resolution:task.resolution||''}};
  // Explicit options are mandatory: never silently send with a different model or duration.
  const options = [
    ['modeControl','视频生成',true],
    ['modelControl',task.model,Boolean(task.model)],
    ['durationControl',task.duration==null?'':task.duration+'s',task.duration!=null],
    ['ratioControl',task.ratio,Boolean(task.ratio)],
    ['resolutionControl',task.resolution,Boolean(task.resolution)],
  ];
  for(const [key,label,required] of options) {
    signal.throwIfAborted(); if(!required) continue;
    if(key==='modeControl' && await page.locator('[data-input-engine-actionbar-control-key="video-model"]').isVisible().catch(()=>false))continue;
    const selector=selectors[key] || (key==='resolutionControl'?selectors.durationControl:undefined);
    if(selector) {
      if(task.platform==='doubao'&&key!=='modeControl'&&key!=='modelControl'&&!await page.locator(selector).isVisible().catch(()=>false)){const sidebar=page.locator('[data-testid="siderbar_close_btn"]');if(await sidebar.isVisible().catch(()=>false)){await sidebar.click();await wait(350,undefined,{signal});}}
      const control=await firstVisible(page,selector,5000);await control.click();
    } else if(key==='modeControl') {
      const controls=page.getByText(/^(视频生成|生成视频|Video)$/);let found=false;
      for(let i=0;i<await controls.count();i++) if(await controls.nth(i).isVisible()){await controls.nth(i).click();found=true;break;}
      if(!found && task.platform!=='fixture') throw new Error('没有找到视频模式入口，请先配置账号的modeControl选择器');
      continue;
    } else {
      throw new Error('指定了'+label+'，但未配置'+key+'选择器；请在账号高级设置中配置，或留空使用网页当前设置');
    }
    if(key==='modeControl') continue;
    let applied=false;
    if(key==='durationControl' && task.platform==='doubao')await page.getByRole('slider').waitFor({state:'visible',timeout:5000});
    if(key==='durationControl' && await page.getByRole('slider').count()){
      const slider=page.getByRole('slider').first();
      const bounds=await slider.evaluate(e=>{
        let p=e;
        for(let i=0;p&&i<8;i++,p=p.parentElement){const values=[...(p.textContent||'').matchAll(/(\d+)s/g)].map(m=>Number(m[1]));if(values.length>=2)return {min:Math.min(...values),max:Math.max(...values)};}
        return null;
      });
      const ariaMin=Number(await slider.getAttribute('aria-valuemin')),ariaMax=Number(await slider.getAttribute('aria-valuemax'));
      if(!bounds || task.duration<bounds.min || task.duration>bounds.max || ariaMax-ariaMin!==bounds.max-bounds.min)throw new Error('当前模型时长滑块不支持所选秒数');
      await slider.press('Home');for(let n=bounds.min;n<task.duration;n++)await slider.press('ArrowRight');applied=true;
    }
    const choices=page.getByText(label,{exact:true});
    if(!applied)await choices.first().waitFor({state:'visible',timeout:5000}).catch(()=>{});
    for(let i=0;!applied && i<await choices.count();i++) if(await choices.nth(i).isVisible()){await choices.nth(i).click();applied=true;break;}
    if(!applied) throw new Error('页面没有可选参数：'+label+'；已停止提交');
    await page.keyboard.press('Escape');
    await wait(350,undefined,{signal});
    if(key==='durationControl' || key==='ratioControl' || key==='resolutionControl'){
      const trigger=page.locator(selector);const expected=key==='durationControl'?String(task.duration)+'s':key==='resolutionControl'?task.resolution:task.ratio;
      const end=Date.now()+3000;let confirmed=false;
      while(Date.now()<end){if((await trigger.innerText()).includes(expected)){confirmed=true;break;}await wait(100);}
      if(!confirmed)throw new Error('页面参数回读未确认：'+expected+'；已停止提交');
    }
  }
  const modelControl=page.locator(selectors.modelControl||'[data-input-engine-actionbar-control-key="video-model"]');
  const parameterControl=page.locator(selectors.durationControl||selectors.ratioControl||'[data-input-engine-actionbar-render-entry-key="video-generation-params-panel"]');
  proof.applied={model:await modelControl.first().innerText().catch(()=>''),summary:await parameterControl.first().innerText().catch(()=>''),duration:null,ratio:''};
  const durationMatch=proof.applied.summary.match(/(\d+)s/);if(durationMatch)proof.applied.duration=Number(durationMatch[1]);
  proof.applied.ratio=proof.applied.summary.match(/\d+:\d+/)?.[0] || (proof.applied.summary.includes('自动')?'auto':'');
  if(task.duration!=null && proof.applied.duration!==task.duration && task.platform==='doubao')throw new Error('时长回读不一致，未提交生成');
  if(task.ratio && proof.applied.ratio!==task.ratio && task.platform==='doubao')throw new Error('画幅回读不一致，未提交生成');
  proof.applied.resolution=proof.applied.summary.match(/(?:480|720|1080|2160)p/i)?.[0]||'';
  if(task.resolution && proof.applied.resolution.toLowerCase()!==task.resolution.toLowerCase())throw new Error('分辨率回读不一致，未提交生成');
  return proof;
}
async function submitText(page, text, selectors, signal, beforeSend, referenceFiles = null) {
  signal.throwIfAborted();
  const editor=await firstVisible(page,selectors.editor || 'textarea, [contenteditable="true"][role="textbox"], [data-slate-editor="true"], [contenteditable="true"]');
  const binding=referenceFiles ? await require('./adapters/doubao-mentions').bindReferences(page,editor,text,referenceFiles,signal) : null;
  if(!binding)await editor.fill(text);
  signal.throwIfAborted();
  if(beforeSend && await beforeSend(binding)===false)return binding;
  if(selectors.send) await (await firstVisible(page,selectors.send,5000)).click();
  else {
    const stableSend=page.locator('[data-testid="chat_input_send_button"]');
    if(await stableSend.count() && await stableSend.isVisible()){await stableSend.click();return;}
    const send=page.getByRole('button',{name:/^(发送|发送消息|Send|Send message)$/i});
    if(await send.count() && await send.first().isVisible()) await send.first().click();
    else await editor.press('Enter');
  }
}
async function uploadReferences(page, files, selectors, signal, platform, update = () => {}) {
  if(!files.length) return;
  // Doubao exposes authoritative upload completion in attachmentStates; a separate
  // progress selector is optional there, but remains mandatory for generic pages.
  selectors = { ...selectors };
  if (platform === 'doubao') {
    selectors.attachment ||= '[data-testid="attachment-image-card"]';
    selectors.upload ||= 'input[data-testid="upload-file-input"], input[type="file"]';
  }
  if(!selectors.attachment || (platform !== 'doubao' && !selectors.uploading)) throw new Error('参考图上传需要配置attachment和uploading选择器，避免未上传完成就发送');
  const trace = require('./adapters/upload-trace').uploadTrace(page);
  try { for(const [fileIndex,file] of files.entries()) {
    const started=Date.now();let lastChange=started,lastFingerprint='',lastUpdate=0;const history=[];
    signal.throwIfAborted();
    update({status:'uploading',message:'准备上传参考图 '+(fileIndex+1)+'/'+files.length+'：'+path.basename(file),progress:5+Math.round(fileIndex/files.length*10)});
    const before=await page.locator(selectors.attachment).count();
    const beforeStates=platform==='doubao'?await page.evaluate(readAttachmentState,selectors.attachment):[];
    const uploader=page.locator(selectors.upload || 'input[type="file"]').first();
    if(await uploader.count()) await uploader.setInputFiles(file);
    else if(selectors.uploadButton){
      const chooserPromise=page.waitForEvent('filechooser',{timeout:10000}).catch(error=>error);
      await (await firstVisible(page,selectors.uploadButton,5000)).click();
      if(selectors.uploadMenuItem)await (await firstVisible(page,selectors.uploadMenuItem,5000)).click();
      const chooser=await chooserPromise;if(chooser instanceof Error)throw new Error('图片选择器未打开');
      await chooser.setFiles(file);
    }else throw new Error('找不到图片上传控件，请配置uploadButton和uploadMenuItem');
    const end=Date.now()+120000;let ready=false;
    while(Date.now()<end) {
      signal.throwIfAborted();
      const count=await page.locator(selectors.attachment).count();
      const uploading=selectors.uploading ? await page.locator(selectors.uploading).count() : 0;
      const currentStates=platform==='doubao'?await page.evaluate(readAttachmentState,selectors.attachment):[];
      const current=currentStates.find(s=>s.fileName===path.basename(file));
      const fingerprint=JSON.stringify(current||{count});
      if(fingerprint!==lastFingerprint){lastFingerprint=fingerprint;lastChange=Date.now();history.push({elapsedMs:Date.now()-started,status:current?.status,percent:current?.uploadPercent});if(history.length>20)history.shift();}
      if(Date.now()-lastUpdate>=2000){lastUpdate=Date.now();const percent=current?.uploadPercent||0;const stalled=Date.now()-lastChange>=30000;update({status:'uploading',message:'上传参考图 '+(fileIndex+1)+'/'+files.length+'：'+path.basename(file)+' · '+percent+'%'+(stalled?'（进度停滞，仍在等待平台确认）':''),progress:5+Math.round((fileIndex+percent/100)/files.length*10),uploadState:{index:fileIndex+1,total:files.length,fileName:path.basename(file),percent,elapsedMs:Date.now()-started,stalled}});}
      if(count===before+1 && uploading===0) {
        if(platform==='doubao'){
          const old=new Set(beforeStates.map(s=>s.fileKey));
          const added=currentStates.filter(s=>!old.has(s.fileKey));
          if(currentStates.length===before+1 && currentStates.every(s=>s.status==='Normal'&&s.uploadPercent>=100&&s.fileKey&&s.width>0&&s.height>0)
            && added.length===1 && added[0].fileName===path.basename(file)){ready=true;break;}
        }else {ready=true;break;}
      }
      await wait(300,undefined,{signal});
    }
    if(!ready) {
      const states=platform==='doubao'?await page.evaluate(readAttachmentState,selectors.attachment):[];
      const count=await page.locator(selectors.attachment).count();
      const error=new Error('参考图未确认上传完成，已停止发送：'+path.basename(file));
      error.uploadDiagnostics={expectedCount:before+1,actualCount:count,attachments:states,elapsedMs:Date.now()-started,stalledMs:Date.now()-lastChange,history,network:trace.events.slice()};
      throw error;
    }
    update({status:'uploading',message:'参考图 '+(fileIndex+1)+'/'+files.length+' 上传完成：'+path.basename(file),progress:5+Math.round((fileIndex+1)/files.length*10)});
  }
    return {expectedCount:files.length,actualCount:await page.locator(selectors.attachment).count(),attachments:platform==='doubao'?await page.evaluate(readAttachmentState,selectors.attachment):[],network:trace.events.slice()};
  } finally { trace.stop(); }
}
async function prepareInputs(page,task,selectors,signal,platform,update=()=>{}) {
  signal.throwIfAborted();
  const editor=await firstVisible(page,selectors.editor||'textarea,[contenteditable=true]');
  // Upload into a fresh composer. Filling a long prompt before upload can retain
  // stale attachment props; the verified native binding writes the prompt later.
  await editor.fill('');
  update({status:'configuring',message:'设置视频参数',progress:3});
  const parameters=await applyOptions(page,task,selectors,signal);update({parameters});
  const uploadDiagnostics=await uploadReferences(page,task.references,selectors,signal,platform,update);
  return {parameters,uploadDiagnostics};
}
// 下载地址解析顺序（豆包）：插件 fallback_api 无水印原片 → 官方节点接口 → 页面明确标记的地址。
// fallback_api 是实测可用的主路径（evidence/live-no-watermark-probe.md），对 removeWatermark=false 的任务也同样优先，
// 因为它返回的是高码率原片；任何情况下都不把带水印文件当无水印结果。
async function resolveGeneratedMedia({ page, state, task, anchorKey = '', signal, getDispatcher, resolveFallback = resolveFallbackVideo }) {
  const diagnostics = [];
  const ids = state.replies.map(r => r.id).filter(id => /^\d{8,}$/.test(id));
  if (task.platform === 'doubao' && ids.length) {
    const fallback = await resolveFallback({ page, messageIds: ids, signal, getDispatcher });
    diagnostics.push({ method: 'fallback-api', matchedApis: fallback.matchedApis ?? fallback.diagnostics?.length ?? 0, results: fallback.diagnostics || [] });
    if (fallback.url) {
      return { media: { url: fallback.url, method: 'fallback-api-unwatermarked' }, ownership: { userKey: anchorKey, messageIds: [fallback.messageId] }, diagnostics };
    }
    if (task.removeWatermark) {
      const resolved = await page.evaluate(async messageIds => {
        const api = window.__LOCAL_DOUBAO_RESOLVER__; if (!api) return null;
        const nodes = await api.nodesForMessages(messageIds);
        for (const id of nodes) { try { return await api.downloadInfo(id); } catch {} }
        return null;
      }, ids);
      if (resolved?.mainUrl) {
        return { media: { url: resolved.mainUrl, method: 'official-no-watermark', nodeId: resolved.nodeId }, ownership: { userKey: anchorKey, messageIds: ids }, diagnostics };
      }
    }
  }
  const candidate = state.media.find(m => m.ready);
  if (candidate && (!task.removeWatermark || candidate.confirmedNoWatermark)) {
    return { media: { url: candidate.url, method: task.removeWatermark ? 'explicit-no-watermark' : 'page-video' },
      ownership: { userKey: anchorKey, messageIds: [candidate.messageId], assistantKey: candidate.messageKey }, diagnostics };
  }
  return null;
}
function createExecutor({ pool, store, downloads, ffprobe, fixture=false, getDispatcher, prepareOnly=false }) {
  return async function execute(task, account, signal, update) {
    let page;let finished=false;
    try {
      signal.throwIfAborted();if(task.nextPollAt>Date.now())await wait(task.nextPollAt-Date.now(),undefined,{signal});page=await pool.taskPage(account,task.resume?task.conversationURL:undefined); const selectors=selectorsFor(account.platform,account);
      await firstVisible(page,selectors.editor || 'textarea,[contenteditable="true"]',30000);
      const abort=()=>{ page?.close().catch(()=>{}); };signal.addEventListener('abort',abort,{once:true});
      try {
        signal.throwIfAborted();
        // Require a new conversation when the landing page already contains messages.
        let initial=await page.evaluate(readPageState,{selectors});
        if(initial.messageCount && !task.resume) {
          if(!selectors.newChat) throw new Error('当前页面已有历史消息，请配置newChat选择器以创建独立任务会话');
          await (await firstVisible(page,selectors.newChat,5000)).click();
          await wait(500,undefined,{signal});
          initial=await page.evaluate(readPageState,{selectors});
          if(initial.messageCount) throw new Error('新会话未清空历史消息，已停止提交');
        }
        if(task.platform==='doubao') await page.evaluate(resolver);
        let prepared;
        if(!task.resume)prepared=await prepareInputs(page,task,selectors,signal,account.platform,update);
        if(task.resume){await page.locator('[data-testid="message-list"] .scroller').evaluateAll(es=>es.forEach(e=>{e.scrollTop=0;}));await wait(500,undefined,{signal});}
        const before=task.resume?{keys:[],captcha:false}:await page.evaluate(readPageState,{selectors});
        if(before.captcha) {update({status:'paused',message:'请在账号窗口完成人工验证'});throw new Error('提交前需要人工验证，请完成后重新提交');}
        update({status:'submitting',message:'提交提示词',progress:10});
        let preparedBinding;
        if(!task.resume)await submitText(page,task.prompt,selectors,signal,(binding)=>{
          preparedBinding=binding;
          if(prepareOnly)return false;
          if(binding)update({submittedPrompt:binding.text,referenceBindings:binding.bindings});
          const quota=store.consumeQuota(account.id);update({quotaCharged:true,quotaDate:quota.date});
        },account.platform==='doubao'?task.references:null);
        if(prepareOnly)return {sent:false,mode:'executor-before-send',text:preparedBinding?.text||task.prompt,bindings:preparedBinding?.bindings||[],parameters:prepared?.parameters,uploadDiagnostics:prepared?.uploadDiagnostics};
        const deadline=Date.now()+task.timeoutSeconds*1000;
        let anchorKey='',submittedDeadline=Date.now()+60000, confirmations=0,lastConfirmation='',lastReply='',stableSince=Date.now();
        let media,ownership;
        while(Date.now()<deadline) {
          signal.throwIfAborted();
          if(task.nextPollAt>Date.now())await wait(task.nextPollAt-Date.now(),undefined,{signal});
          Object.assign(selectors,store.get(account.id)?.selectors || {});
          const state=await page.evaluate(readPageState,{selectors,baseline:before.keys,prompt:task.submittedPrompt||task.prompt,anchorKey,attachments:(task.references||[]).length});
          if(state.otherUser){
            update({conversationURL:page.url(), userKey:state.userKey, ownershipDiagnostics:{messageCount:state.messageCount,userId:state.userId,messages:state.messages||[]}});
            const seen=(state.messages||[]).filter(m=>m.role==='user'&&m.text).map(m=>m.text.slice(0,80));
            throw new Error('任务会话出现额外用户消息，已停止操作以避免混用结果'+(seen.length?'；会话中的用户消息：'+seen.join(' / '):''));
          }
          if(state.captcha) {
            // 人工验证只能由人在账号窗口里完成；把窗口提到最前，避免看起来“卡住不动”。
            if(!task.captchaPausedAt)update({captchaPausedAt:new Date().toISOString()});
            await page.bringToFront().catch(()=>{});
            update({status:'paused',message:'豆包要求人工验证：请在账号窗口里完成滑块/验证后不要关闭窗口，任务会自动继续',progress:20});
            await wait(1000,undefined,{signal});continue;
          }
          if(task.captchaPausedAt)update({captchaPausedAt:null});
          anchorKey=state.userKey || anchorKey;
          if(anchorKey && !state.pendingConversation)update({conversationURL:page.url().split('?')[0],submittedAt:task.submittedAt||new Date().toISOString()});
          if(state.failedSend || state.pendingConversation){
            if(Date.now()>submittedDeadline)throw new Error('平台尚未确认接收请求，请检查账号或网络；未自动重复提交');
            await wait(500,undefined,{signal});continue;
          }
          if(!anchorKey) {
            if(Date.now()>submittedDeadline) throw new Error('发送未确认：没有找到本次新增用户消息。请检查userMessage选择器；为避免重复生成，未自动重发');
            await wait(500,undefined,{signal});continue;
          }
          if(anchorKey)await page.locator('[data-testid="message-list"] .scroller').evaluateAll(es=>es.forEach(e=>{e.scrollTop=e.scrollHeight;}));
          if(state.text!==lastReply){lastReply=state.text;stableSince=Date.now();}
          const awaitingConfirmation=state.confirmation && !state.confirmationSent && !task.confirmationSentAt;
          const generating=state.generating && !state.responding && !awaitingConfirmation;
          update({status:'generating',message:state.responding?'豆包正在回复方案，等待回复完成':awaitingConfirmation?'方案已回复，等待稳定后确认生成':generating?'平台正在生成':'等待本次会话回复',progress:30});
          if(generating&&!task.generationWaitStartedAt){update({generationWaitStartedAt:new Date().toISOString(),nextPollAt:Date.now()+5*60*1000,pollIntervalSeconds:30,message:'平台正在生成：先等待5分钟，随后每30秒查询一次'});}
          // A playable video in a new assistant reply takes priority over text rules.
          const candidate=state.media.find(m=>m.ready);
          if(candidate || state.complete) {
            update({platformGenerated:true,status:'downloading',message:'平台视频已生成，正在解析下载地址',progress:85});
            const plan=await resolveGeneratedMedia({page,state,task,anchorKey,signal,getDispatcher});
            if(plan) {
              if(plan.diagnostics.length)update({downloadDiagnostics:plan.diagnostics[0]});
              media=plan.media;ownership=plan.ownership;break;
            }
            if(state.complete && Date.now()-stableSince>30000) throw new Error('平台视频已生成，下载失败：没有找到可确认归属的'+(task.removeWatermark?'无水印原片':'MP4')+'地址；已停止，未返回其他历史成片');
          }
          if(state.canceled){
            const canceled=new Error(task.stopRequestedAt?'已通过管理器取消视频生成':'平台已确认取消视频生成');canceled.code='CANCELED';throw canceled;
          }
          if(state.quota) {
            const current=store.get(account.id);store.update(account.id,{quotaUsed:current.quota.limit,cooldownUntil:0});
            const error=new Error('平台额度不足，已标记该账号今日额度用完；平台原文：'+state.text.slice(-500));error.code='ACCOUNT_QUOTA_EXHAUSTED';throw error;
          }
          if(state.refusal) throw new Error('平台拒绝：'+state.text.slice(-1000));
          if(state.failure) throw new Error('平台生成失败：'+state.text.slice(-1000));
          if(!generating && !state.responding && !state.confirmationSent && confirmations===0 && !task.confirmationSentAt && !task.stopRequestedAt && state.confirmation && Date.now()-stableSince>=15000 && state.text!==lastConfirmation) {
            confirmations++;update({confirmationSentAt:new Date().toISOString(),message:'方案回复已结束，正在确认生成视频'});
            update({status:'submitting',message:'平台方案已输出完成，确认并开始生成视频',progress:25});
            await submitText(page,'确认，开始生成视频',selectors,signal);lastConfirmation=state.text;
          }
          if(task.generationWaitStartedAt){if(!task.nextPollAt||task.nextPollAt<=Date.now())update({nextPollAt:Date.now()+30000});}else await wait(1000,undefined,{signal});
        }
        if(!media) throw new Error('等待本次生成超时；未自动重发平台请求');
        signal.throwIfAborted();update({status:'downloading',message:'下载并检查MP4完整性与时长',progress:90});
        const downloadsDir=typeof downloads==='function'?downloads():downloads;
        const destination=path.join(downloadsDir,task.id+'.mp4');
        const result=await downloadVideo({url:media.url,page,destination,signal,ffprobe,allowLocal:fixture,getDispatcher});
        signal.throwIfAborted();finished=true;
        return {...result,file:path.basename(result.path),watermarkMethod:media.method,ownership,downloadedAt:new Date().toISOString()};
      } catch(error){
        if(/Target page, context or browser has been closed|has been closed/i.test(String(error?.message||error)))
          throw new Error('账号浏览器窗口被关闭，任务已中断；遇到人工验证请直接在窗口里完成，不要关闭窗口');
        throw error;
      } finally {signal.removeEventListener('abort',abort);}
    } finally {
      // Keep failed pages available for diagnosis and manual login/verification.
      if(finished && page && !page.isClosed()) await page.close().catch(()=>{});
    }
  };
}
module.exports = { createExecutor, firstVisible, submitText, uploadReferences, prepareInputs, applyOptions, resolveGeneratedMedia, selectorsFor, DOUBAO_DEFAULTS };
