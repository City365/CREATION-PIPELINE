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
// 确认和催促都用语义相近的多种说法，避免同一句固定话术反复出现。
// 每次从洗牌袋里取一条，同一进程内不会连续重复；重启后重新随机。
const CONFIRM_TEXTS=[
  '确认，开始生成视频',
  '确定，生成视频',
  '可以生成视频吧',
  '好的，请开始生成视频',
  '没问题，直接生成视频',
  '同意，开始生成吧',
  '快点，给我生成视频',
  '就按这个生成视频',
  '开始吧，生成视频',
];
const PUSH_TEXTS=[
  '我确定要生成视频，请按上面的提示词直接生成',
  '请继续，用刚才的描述生成视频',
  '不需要文字方案，直接生成视频',
  '可以生成，开始吧，生成视频',
  '请帮我生成视频，就按上面的内容',
  '我确认要生成，直接开始生成视频',
  '用上面的提示词生成视频，谢谢',
];
function makePhrasePicker(pool){
  let bag=[];
  return (avoid='')=>{
    if(!bag.length){
      bag=[...pool];
      for(let i=bag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
    }
    const index=Math.max(0,bag.findIndex(t=>t!==avoid));
    return bag.splice(index,1)[0];
  };
}
const pickConfirmText=makePhrasePicker(CONFIRM_TEXTS);
const pickPushText=makePhrasePicker(PUSH_TEXTS);
async function firstVisible(page, selector, timeout=15000) {  const end=Date.now()+timeout;
  while(Date.now()<end) {
    const locator=page.locator(selector); const count=await locator.count();
    for(let i=0;i<count;i++) if(await locator.nth(i).isVisible()) return locator.nth(i);
    await wait(200);
  }
  throw new Error('找不到页面控件，请先登录或在账号高级设置中更新选择器：'+selector);
}
// 按可见文字点第一个匹配项；找不到返回 false（不抛错，便于回退到“更多技能”）
async function clickFirstText(page, pattern) {
  const list=page.getByText(pattern);
  const count=await list.count().catch(()=>0);
  for(let i=0;i<count;i++){
    const item=list.nth(i);
    if(!await item.isVisible().catch(()=>false))continue;
    try{await item.click();return true;}catch{continue;}
  }
  return false;
}

// 页面弹窗：先等 3–5 秒（可能自己消失，或用户手动点掉），不要抢着关
const POPUP_SELECTOR='[role="dialog"],[role="alertdialog"],[data-testid*="dialog"],[data-testid*="modal"],[class*="modal"],[class*="popup"],[class*="Dialog"]';
async function visiblePopup(page) {
  const list=page.locator(POPUP_SELECTOR);
  const count=await list.count().catch(()=>0);
  for(let i=0;i<count;i++){
    const item=list.nth(i);
    if(!await item.isVisible().catch(()=>false))continue;
    const box=await item.boundingBox().catch(()=>null);
    if(box && box.width>80 && box.height>40) return item;
  }
  return null;
}
// 已知无害的引导弹窗：识别后主动关掉；验证/确认/额度类弹窗一律不碰。
// 豆包网页版会随机弹「下载电脑版 · 使用完整功能」，不关掉会一直挡住参数面板点击。
async function dismissBenignPopup(popup) {
  if(typeof popup.innerText!=='function' || typeof popup.getByText!=='function')return false;
  const text=String(await popup.innerText().catch(()=> '')||'');
  if(!/下载电脑版|使用完整功能/.test(text))return false;
  for(const label of ['下次提醒我','下次再说']){
    const btn=popup.getByText(label,{exact:true}).first();
    if(await btn.count().catch(()=>0) && await btn.isVisible().catch(()=>false)){
      try{await btn.click({timeout:3000});return true;}catch{/* 换下一个入口 */}
    }
  }
  const close=popup.locator('[aria-label="关闭"]').first();
  if(await close.count().catch(()=>0) && await close.isVisible().catch(()=>false)){
    try{await close.click({timeout:3000});return true;}catch{/* 保持等待 */}
  }
  return false;
}
async function settlePopups(page,{signal,update,label='页面提示弹窗',graceMs=5000,maxWaitMs=120000}={}) {
  const started=Date.now();
  let announced=false;let dismissed=0;
  while(true){
    signal?.throwIfAborted?.();
    const popup=await visiblePopup(page);
    if(!popup)return true;
    if(dismissed<3 && await dismissBenignPopup(popup)){
      dismissed++;
      update?.({message:label+'：已识别并关闭「下载电脑版」引导弹窗'});
      await wait(300,undefined,{signal});
      continue;
    }
    const waited=Date.now()-started;
    if(!announced && waited>=graceMs){
      announced=true;
      await page.bringToFront().catch(()=>{});
      update?.({status:'paused',message:label+'还开着：请在账号窗口里手动点掉它（任务会等 2 分钟，自己消失也会继续）'});
    }
    if(waited>=maxWaitMs)return false;
    await wait(400,undefined,{signal});
  }
}
async function applyOptions(page, task, selectors, signal, hooks={}) {
  const proof={requested:{model:task.model||'',ratio:task.ratio||'',duration:task.duration??null,resolution:task.resolution||''}};
  // phase=mode 只点「视频生成」进视频模式；phase=rest 只调模型/时长/比例；默认一次做完。
  const phase=hooks.phase||'all';
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
    if(phase==='mode' && key!=='modeControl') continue;
    if(phase==='rest' && key==='modeControl') continue;
    if(key==='modeControl' && await page.locator('[data-input-engine-actionbar-control-key="video-model"]').isVisible().catch(()=>false))continue;
    const selector=selectors[key] || (key==='resolutionControl'?selectors.durationControl:undefined);
    if(key==='modeControl') {
      // 真实页面：入口可能是露在外面的「视频生成」，也可能收在「更多技能」里；
      // 页面里同名元素有多份（隐藏副本），必须取可见的、并且点完确认真的进了视频模式。
      const inVideoMode=async()=>await page.locator('[data-input-engine-actionbar-control-key="video-model"]').isVisible().catch(()=>false)
        || await page.locator('[data-input-engine-actionbar-render-entry-key="video-generation-params-panel"]').isVisible().catch(()=>false);
      const hasVideoText=async()=>await page.evaluate(()=>document.body.innerText.includes('视频生成')).catch(()=>false);
      const clickVisible=async(build,{verify=true}={})=>{
        let loc=null;
        try{ loc=build(); }catch{ return false; }
        if(!loc) return false;
        const count=await loc.count().catch(()=>0);
        for(let i=0;i<count;i++){
          const el=loc.nth(i);
          if(!await el.isVisible().catch(()=>false))continue;
          try{ await el.click(); }catch{ continue; }
          await wait(700,undefined,{signal});
          if(!verify || await inVideoMode()) return true;
        }
        return false;
      };
      // 打开「更多技能」菜单：页面里同一 testid 有多份副本，实测只有第 1 个能展开菜单，
      // 所以先用 JS 点第 1 个，再校验「视频生成」是否真的出现，避免反复点把菜单关掉。
      const openSkillMenu=async()=>{
        if(await hasVideoText())return true;
        const jsClick=async(kind)=>page.evaluate((k)=>{
          const pick=()=>{
            if(k==='first')return document.querySelectorAll('[data-testid="skill_bar_button_more"]')[0]||null;
            if(k==='text')return [...document.querySelectorAll('div,span')].find((e)=>(e.innerText||'').trim()==='更多技能')||null;
            if(k==='parent'){const el=[...document.querySelectorAll('div,span')].find((e)=>(e.innerText||'').trim()==='更多技能');return el?(el.closest('button,[role="button"]')||el.parentElement):null;}
            return null;
          };
          const el=pick();
          if(!el)return false;
          el.click();
          return true;
        },kind).catch(()=>false);
        for(const kind of ['first','text','parent']){
          if(!await jsClick(kind))continue;
          await wait(700,undefined,{signal});
          if(await hasVideoText())return true;
        }
        // Playwright 真实鼠标兜底（有些浮层只对真实 hover/click 响应）
        const byId=page.locator('[data-testid="skill_bar_button_more"]').first();
        if(await byId.isVisible().catch(()=>false)){
          await byId.hover({timeout:2000}).catch(()=>{});
          await wait(500,undefined,{signal});
          if(await hasVideoText())return true;
          await byId.click({timeout:2000}).catch(()=>{});
          await wait(700,undefined,{signal});
          if(await hasVideoText())return true;
        }
        return await hasVideoText();
      };
      const clickVideoEntry=async()=>{
        // 先点确定的技能条按钮；getByText 会同时命中按钮里的 span 副本，点错副本会白等超时。
        if(await clickVisible(()=>page.locator('[data-testid^="skill_bar_button_"]').filter({hasText:'视频生成'})))return true;
        if(await clickVisible(()=>page.getByText(/^\s*(视频生成|生成视频|Video)\s*$/)))return true;
        if(await clickVisible(()=>page.getByText('视频生成',{exact:false})))return true;
        // JS 兜底：直接点正文为「视频生成」的可见元素
        const js=await page.evaluate(()=>{
          const el=[...document.querySelectorAll('[data-testid^="skill_bar_button_"],button,[role="button"],[role="menuitem"],div,span')]
            .filter((e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;})
            .find((e)=>(e.innerText||'').trim()==='视频生成');
          if(!el)return false;el.click();return true;
        }).catch(()=>false);
        if(js){await wait(700,undefined,{signal});}
        return js ? await inVideoMode() : false;
      };
      // 编辑器比底部技能条先出现；技能条没渲染就点不到「视频生成」，先等它出现再尝试。
      const skillBar=page.locator('[data-testid^="skill_bar_button_"]');
      const readyDeadline=Date.now()+Number(hooks.skillBarTimeoutMs ?? 20000);
      while(Date.now()<readyDeadline){
        if(await skillBar.count().catch(()=>0))break;
        await wait(400,undefined,{signal});
      }
      // 新版页面把「视频生成」收进输入框左下角的「对话」模式菜单里，先点开这个菜单再选。
      const tryModeMenu=async()=>{
        const chip=page.locator('[data-testid="chat_input_action_mode"]').first();
        if(!await chip.count().catch(()=>0))return false;
        if(!await chip.isVisible().catch(()=>false))return false;
        await chip.click({timeout:3000}).catch(()=>null);
        await wait(600,undefined,{signal});
        const item=page.locator('[role="menuitem"],[data-radix-collection-item]').filter({hasText:/视频生成|生成视频/}).first();
        if(await item.count().catch(()=>0) && await item.isVisible().catch(()=>false)){
          await item.click({timeout:3000}).catch(()=>null);
          await wait(900,undefined,{signal});
          if(await inVideoMode())return true;
        }
        const js=await page.evaluate(()=>{
          const el=[...document.querySelectorAll('[role="menuitem"],[role="option"],div,span')]
            .filter((e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;})
            .find((e)=>(e.innerText||'').trim()==='视频生成');
          if(!el)return false;el.click();return true;
        }).catch(()=>false);
        if(js){await wait(900,undefined,{signal});if(await inVideoMode())return true;}
        await page.keyboard.press('Escape').catch(()=>null);
        return false;
      };
      let entered=false;
      const tried=[];
      if(selector){ tried.push('账号配置'); entered=await clickVisible(()=>page.locator(selector)); }
      if(!entered){ tried.push('直接入口'); entered=await clickVideoEntry(); }
      if(!entered){ tried.push('模式菜单'); entered=await tryModeMenu(); }
      if(!entered){
        tried.push('更多技能');
        if(await openSkillMenu()) entered=await clickVideoEntry();
        if(entered) hooks.update?.({message:'已通过「更多技能」进入视频模式'});
      }
      if(!entered && task.platform!=='fixture'){
        // 只报可见控件：同一个 testid 在页面里可能有多份隐藏副本，直接 count 会误导排查。
        const diag=await page.evaluate(()=>{
          const isVisible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
          const labels=[...document.querySelectorAll('[data-testid^="skill_bar_button_"]')].filter(isVisible)
            .map(e=>(e.innerText||'').trim()).filter(Boolean).slice(0,10);
          const more=[...document.querySelectorAll('[data-testid="skill_bar_button_more"]')].filter(isVisible).length;
          return {labels,more};
        }).catch(()=>({labels:[],more:0}));
        const diagInfo=diag&&typeof diag==='object'?diag:{};
        const diagLabels=Array.isArray(diagInfo.labels)?diagInfo.labels:[];
        const diagText='页面 '+(page.url?page.url():'?')
          +'；可见「更多技能」按钮 '+(Number(diagInfo.more)||0)+' 个'
          +'；可见技能条按钮：'+(diagLabels.length?diagLabels.join(' / '):'无')
          +'；页面含「视频生成」文字：'+(await hasVideoText()?'有':'无');
        throw new Error('没有找到视频模式入口（已尝试：'+tried.join(' → ')+'；'+diagText+'）；请在账号窗口确认页面有「视频生成」，或更新 modeControl 选择器');
      }
      await settlePopups(page,{signal,update:hooks.update,label:'切换到视频模式后的提示'});
      continue;
    }
    if(selector) {
      if(task.platform==='doubao'&&key!=='modelControl'&&!await page.locator(selector).isVisible().catch(()=>false)){const sidebar=page.locator('[data-testid="siderbar_close_btn"]');if(await sidebar.isVisible().catch(()=>false)){await sidebar.click();await wait(350,undefined,{signal});}}
      const control=await firstVisible(page,selector,5000);await control.click();
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
    // 参数面板还开着才按 Escape 收起来；不主动去关刚冒出来的弹窗
    if(await page.locator(selector).isVisible().catch(()=>false)) await page.keyboard.press('Escape');
    await wait(350,undefined,{signal});
    await settlePopups(page,{signal,update:hooks.update,label:'参数面板旁弹出的提示'});
    if(key==='durationControl' || key==='ratioControl' || key==='resolutionControl'){
      const trigger=page.locator(selector);const expected=key==='durationControl'?String(task.duration)+'s':key==='resolutionControl'?task.resolution:task.ratio;
      const end=Date.now()+3000;let confirmed=false;
      while(Date.now()<end){if((await trigger.innerText()).includes(expected)){confirmed=true;break;}await wait(100);}
      if(!confirmed)throw new Error('页面参数回读未确认：'+expected+'；已停止提交');
    }
  }
  if(phase==='mode'){proof.phase='mode';proof.applied={mode:await page.locator('[data-input-engine-actionbar-control-key="video-model"]').first().innerText().catch(()=>'')};return proof;}
  const modelControl=page.locator(selectors.modelControl||'[data-input-engine-actionbar-control-key="video-model"]');
  const parameterControl=page.locator(selectors.durationControl||selectors.ratioControl||'[data-input-engine-actionbar-render-entry-key="video-generation-params-panel"]');
  proof.phase=phase;
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
  // 图片引用策略：豆包原生 @ 图片芯片默认停用（详见 adapters/doubao-mentions.js 顶部说明）。
  // 停用时 <Picture n>/@图片n 一律降级为纯文本「图n」后直接写入输入框；
  // 只有显式 DBM_NATIVE_MENTIONS=1 才回到 bindReferences 的敲 @ → 选候选 → 核验芯片链路。
  const mentions=require('./adapters/doubao-mentions');
  const binding=(referenceFiles && mentions.nativeMentionsEnabled()) ? await mentions.bindReferences(page,editor,text,referenceFiles,signal) : null;
  if(!binding)await editor.fill(mentions.pictureTagsToText(text));
  signal.throwIfAborted();
  if(beforeSend && await beforeSend(binding)===false)return binding;
  await clickSend(page,selectors,editor);
}

// 只负责点发送：文本已经落在输入框里时直接走这里，不再重填。
async function clickSend(page,selectors,editor){
  if(selectors.send){await (await firstVisible(page,selectors.send,5000)).click();return;}
  const stableSend=page.locator('[data-testid="chat_input_send_button"]');
  if(await stableSend.count() && await stableSend.isVisible()){await stableSend.click();return;}
  const send=page.getByRole('button',{name:/^(发送|发送消息|Send|Send message)$/i});
  if(await send.count() && await send.first().isVisible()){await send.first().click();return;}
  await editor.press('Enter');
}
async function uploadReferences(page, files, selectors, signal, platform, update = () => {}, options = {}) {
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
    let uploader=page.locator(selectors.upload || 'input[type="file"]').first();
    let handed=false;
    // 对话态（还没进视频模式）页面上没有 file input，要先点左下角「+」把入口展开/唤起选择器。
    if(!await uploader.count()){
      const plus=page.locator('[data-testid="upload_file_button"]').first();
      if(await plus.count().catch(()=>0) && await plus.isVisible().catch(()=>false)){
        const chooserPromise=page.waitForEvent('filechooser',{timeout:6000}).catch(()=>null);
        await plus.click({timeout:4000}).catch(()=>null);
        const chooser=await chooserPromise;
        if(chooser){ await chooser.setFiles(file); handed=true; }
        await wait(700,undefined,{signal});
        uploader=page.locator(selectors.upload || 'input[type="file"]').first();
        if(!handed && await uploader.count()){ await uploader.setInputFiles(file); handed=true; }
        if(!chooser && !await uploader.count()){
          // 「+」可能弹出菜单，里面有拍照/上传选项
          const menuItem=page.locator('[role="menuitem"],[data-radix-collection-item]').filter({hasText:/上传|文件|图片/}).first();
          if(await menuItem.count().catch(()=>0) && await menuItem.isVisible().catch(()=>false)){
            const chooser2=page.waitForEvent('filechooser',{timeout:6000}).catch(()=>null);
            await menuItem.click({timeout:4000}).catch(()=>null);
            const c2=await chooser2;
            if(c2){ await c2.setFiles(file); handed=true; }
            await wait(500,undefined,{signal});
            uploader=page.locator(selectors.upload || 'input[type="file"]').first();
            if(!handed && await uploader.count()){ await uploader.setInputFiles(file); handed=true; }
          }
        }
      }
    }
    if(!handed){
      if(await uploader.count()){ await uploader.setInputFiles(file); handed=true; }
      else if(selectors.uploadButton){
        const chooserPromise=page.waitForEvent('filechooser',{timeout:10000}).catch(error=>error);
        await (await firstVisible(page,selectors.uploadButton,5000)).click();
        if(selectors.uploadMenuItem)await (await firstVisible(page,selectors.uploadMenuItem,5000)).click();
        const chooser=await chooserPromise;if(chooser instanceof Error)throw new Error('图片选择器未打开');
        await chooser.setFiles(file); handed=true;
      } else throw new Error('找不到图片上传控件，请配置uploadButton和uploadMenuItem');
    }
    const end=Date.now()+(Number(options.maxWaitMs)||120000);let ready=false;
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
      if(options.lenient && count>before){
        // 对话态下页面不暴露上传进度：卡片已经出现就先继续，进视频模式后再复核状态。
        update({status:'uploading',message:'参考图已挂上（对话态不显示进度），进入视频模式后复核：'+path.basename(file),uploadStatePending:true});
        continue;
      }
      const error=new Error('参考图未确认上传完成，已停止发送：'+path.basename(file));
      error.uploadDiagnostics={expectedCount:before+1,actualCount:count,attachments:states,elapsedMs:Date.now()-started,stalledMs:Date.now()-lastChange,history,network:trace.events.slice()};
      throw error;
    }
    update({status:'uploading',message:'参考图 '+(fileIndex+1)+'/'+files.length+' 上传完成：'+path.basename(file),progress:5+Math.round((fileIndex+1)/files.length*10)});
  }
    return {expectedCount:files.length,actualCount:await page.locator(selectors.attachment).count(),attachments:platform==='doubao'?await page.evaluate(readAttachmentState,selectors.attachment):[],network:trace.events.slice()};
  } finally { trace.stop(); }
}
// 提交任务前的暖场：先像普通用户一样聊两轮创作话题，让上下文看起来是正常交流。
// 只发普通聊天，不点确认、不进入视频模式；失败也不影响任务，记录到 warmup 字段即可。
async function waitForChatReply(page,selectors,signal,{baseline,prompt,timeoutMs=45000,stableMs=1500,pollMs=600}={}){
  const end=Date.now()+timeoutMs;let last='';let since=0;
  while(Date.now()<end){
    signal?.throwIfAborted?.();
    const state=await page.evaluate(readPageState,{selectors,baseline,prompt});
    if(state.captcha)return {reply:last,error:'页面要求人工验证'};
    if(state.responding||!state.replies.length){last='';since=0;}
    else if(state.text!==last){last=state.text;since=Date.now();}
    else if(since&&Date.now()-since>=stableMs)return {reply:last,error:''};
    await wait(pollMs,undefined,{signal});
  }
  return {reply:last,error:last?'':'等待暖场回复超时'};
}
async function warmUpConversation({page,task,selectors,signal,update=()=>{},warmup=null}){
  const cfg=warmup&&typeof warmup.config==='function'?warmup.config():warmup;
  if(!cfg||!cfg.enabled)return null;
  const rounds=Math.max(1,Math.min(3,Number(cfg.rounds)||2));
  const timeoutMs=Math.max(3000,Number(cfg.timeoutMs)||45000);
  const stableMs=Number.isFinite(Number(cfg.stableMs))?Math.max(0,Number(cfg.stableMs)):800;
  const pollMs=Math.max(100,Number(cfg.pollMs)||600);
  // 视频模式下输入会被平台当成视频任务，先切回普通对话再暖场。
  const videoMode=()=>page.locator('[data-input-engine-actionbar-control-key="video-model"]').isVisible().catch(()=>false);
  if(await videoMode()){
    const newChat=page.locator(selectors.newChat||DOUBAO_DEFAULTS.newChat).first();
    if(await newChat.count().catch(()=>0)){await newChat.click().catch(()=>{});await wait(800,undefined,{signal});}
  }
  if(await videoMode())return {skipped:'页面停留在视频模式，未暖场'};
  await settlePopups(page,{signal,update,label:'暖场前的页面弹窗',graceMs:4000,maxWaitMs:20000});
  const plan=await warmup.plan({task:{prompt:task.prompt,platform:task.platform},rounds});
  const messages=((plan&&plan.messages)||[]).slice(0,rounds);
  const source=(plan&&plan.source)||'pool';
  const sent=[];
  update({status:'warming',message:'执行前暖场：先和豆包聊创作话题（0/'+messages.length+'）',warmup:{rounds:0,total:messages.length,source}});
  for(let index=0;index<messages.length;index++){
    signal.throwIfAborted();
    const text=messages[index];
    const baseline=(await page.evaluate(readPageState,{selectors})).keys||[];
    update({status:'warming',message:'执行前暖场：和豆包聊创作话题（'+(index+1)+'/'+messages.length+'）',warmup:{rounds:index,total:messages.length,source,messages:sent.map(item=>item.text)}});
    await submitText(page,text,selectors,signal);
    const result=await waitForChatReply(page,selectors,signal,{baseline,prompt:text,timeoutMs,stableMs,pollMs});
    sent.push({text,reply:String(result.reply||'').slice(0,400),error:result.error||''});
    update({warmup:{rounds:index+1,total:messages.length,source,messages:sent.map(item=>item.text)}});
  }
  return {rounds:sent.length,total:messages.length,source,messages:sent,finishedAt:new Date().toISOString()};
}
// 输入顺序：text-first 先写提示词+传参考图，最后再选模型/时长/比例；
// params-first 是老顺序（先选参数再传图）。用 DBM_INPUT_ORDER 切换。
function inputOrder(){const raw=String(process.env.DBM_INPUT_ORDER||'params-first').trim().toLowerCase();
  return raw==='text-first'?'text-first':'params-first';}

// 文本已经在输入框里时，直接发送（带一次空文本保护）。
async function submitPrepared(page,selectors,signal,beforeSend){
  signal.throwIfAborted();
  const editor=await firstVisible(page,selectors.editor || 'textarea,[contenteditable="true"]');
  const text=String(await editor.innerText().catch(()=>'')).trim();
  if(!text)throw new Error('提示词没有留在输入框里，已停止提交');
  signal.throwIfAborted();
  if(beforeSend && await beforeSend()===false)return;
  await clickSend(page,selectors,editor);
}

async function prepareInputs(page,task,selectors,signal,platform,update=()=>{}) {
  signal.throwIfAborted();
  const editor=await firstVisible(page,selectors.editor||'textarea,[contenteditable=true]');
  // 原生 @ 图片引用已停用：提示词统一降级为纯文本「图n」（见 adapters/doubao-mentions.js 顶部说明）
  task={...task,prompt:require('./adapters/doubao-mentions').pictureTagsToText(task.prompt||'')};
  await editor.fill('');
  // 页面加载后可能先弹「下载电脑版」引导，先处理掉再点参数，避免点击被遮罩拦截。
  await settlePopups(page,{signal,update,label:'打开账号页面后的提示'});
  const order=inputOrder();
  if(order==='text-first'){
    // 顺序：写提示词 → 点「视频生成」进视频模式 → 传参考图 → 选模型/时长/比例。
    // 参数放最后，避免切模式或挂附件时把已选参数冲掉。
    // 顺序：上传参考图 → 写提示词 → 点「视频生成」→ 配置参数 → 发送。
    update({status:'configuring',message:'先上传参考图',progress:2,inputOrder:order});
    const uploadDiagnostics=await uploadReferences(page,task.references,selectors,signal,platform,update,{maxWaitMs:45000,lenient:true});
    update({status:'configuring',message:'参考图已上传，写入视频提示词',progress:4,inputOrder:order});
    await editor.fill(task.prompt||'');
    await wait(300,undefined,{signal});
    const typedBeforeMode=String(await editor.innerText().catch(()=>'')).trim();
    update({status:'configuring',message:'图文就位，点「视频生成」进入视频模式',progress:6,inputOrder:order});
    const modeProof=await applyOptions(page,task,selectors,signal,{update,phase:'mode'});
    update({videoMode:modeProof.applied,modeProof,status:'configuring',message:'已进入视频模式，设置参数',progress:7});
    // 视频模式才暴露附件状态，这里复核一次：没到 100% 就等，等到就不是正常附件。
    if((task.references||[]).length){
      const deadline=Date.now()+90000;
      while(Date.now()<deadline){
        const states=await page.evaluate(readAttachmentState,selectors.attachment).catch(()=>[]);
        const bad=states.filter(s=>s.status!=='Normal'||Number(s.uploadPercent)<100);
        if(states.length>=(task.references||[]).length && !bad.length)break;
        await wait(1000,undefined,{signal});
      }
      const finalStates=await page.evaluate(readAttachmentState,selectors.attachment).catch(()=>[]);
      const cardCount=await page.locator(selectors.attachment).count().catch(()=>0);
      update({attachmentsAfterMode:finalStates,attachmentCards:cardCount});
      // 有的版本在视频模式下不暴露附件状态字段，这时以附件卡片数量为准。
      const bad=finalStates.filter(s=>s.status!=='Normal'||Number(s.uploadPercent)<100);
      if(bad.length)throw new Error('参考图在视频模式下仍未上传完成，已停止发送');
      if(!finalStates.length && cardCount<(task.references||[]).length)throw new Error('参考图没有挂在输入框上，已停止发送');
    }
    // 切换模式有可能清空输入框，立刻回读一次。
    if(!String(await editor.innerText().catch(()=>'')).trim() && typedBeforeMode){
      await editor.fill(task.prompt||'');
      await wait(300,undefined,{signal});
      update({status:'configuring',message:'进入视频模式后提示词被清空，已重新写入',progress:8,inputOrder:order});
    }
    update({status:'configuring',message:'最后设置视频参数（模型/时长/比例）',progress:8,inputOrder:order});
    const parameters=await applyOptions(page,task,selectors,signal,{update,phase:'rest'});update({parameters});
    // 切模式/选参数有可能把输入框清空，这里回读一次，空了就补写。
    const stillThere=String(await editor.innerText().catch(()=>'')).trim();
    let promptReFilled=false;
    if(!stillThere){
      await editor.fill(task.prompt||'');
      await wait(300,undefined,{signal});
      promptReFilled=true;
      update({status:'configuring',message:'选参数后提示词被清空，已重新写入',progress:9,promptReFilled:true});
    }
    return {parameters,uploadDiagnostics,inputOrder:order,promptTyped:true,promptReFilled};
  }
  update({status:'configuring',message:'设置视频参数',progress:3,inputOrder:order});
  const parameters=await applyOptions(page,task,selectors,signal,{update});update({parameters});
  const uploadDiagnostics=await uploadReferences(page,task.references,selectors,signal,platform,update);
  return {parameters,uploadDiagnostics,inputOrder:order,promptTyped:false};
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
function createExecutor({ pool, store, downloads, ffprobe, fixture=false, getDispatcher, prepareOnly=false, interpreter=null, warmup=null }) {
  return async function execute(task, account, signal, update) {
    // 原生 @ 图片引用已停用（见 adapters/doubao-mentions.js 顶部完整说明）：
    // 提示词里的 <Picture n> / @图片n / @图n 在这里统一降级成纯文本「图n」，
    // 后面写输入框、回读校验、submittedPrompt 记录用的都是降级后的文本。
    // 想恢复原生 @ 芯片：DBM_NATIVE_MENTIONS=1 并重启管理器。
    task={...task,prompt:require('./adapters/doubao-mentions').pictureTagsToText(task.prompt||'')};
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
        // 提交前先聊两轮创作话题，避免一上来就丢任务；失败只记录，不阻断任务。
        let warmupInfo=null;
        if(!task.resume && !prepareOnly && task.platform==='doubao' && warmup){
          try {
            warmupInfo=await warmUpConversation({page,task,selectors,signal,update,warmup});
            if(warmupInfo)update({warmup:warmupInfo});
          } catch(error) {
            if(/has been closed|Target page, context or browser has been closed/i.test(String(error?.message||error)))throw error;
            signal.throwIfAborted();
            update({warmup:{error:String(error?.message||error),finishedAt:new Date().toISOString()}});
          }
        }
        let prepared;
        if(!task.resume)prepared=await prepareInputs(page,task,selectors,signal,account.platform,update);
        // 提交前如果页面上有弹窗，先给它 3–5 秒（可能自己消失，或让用户手动点掉）
        await settlePopups(page,{signal,update,label:'提交前的页面弹窗'});
        if(task.resume){await page.locator('[data-testid="message-list"] .scroller').evaluateAll(es=>es.forEach(e=>{e.scrollTop=0;}));await wait(500,undefined,{signal});}
        const before=task.resume?{keys:[],captcha:false}:await page.evaluate(readPageState,{selectors});
        if(before.captcha) {update({status:'paused',message:'请在账号窗口完成人工验证'});throw new Error('提交前需要人工验证，请完成后重新提交');}
        update({status:'submitting',message:'提交提示词',progress:10});
        let preparedBinding;
        if(!task.resume&&prepared&&prepared.promptTyped){
          // 新顺序：提示词和参考图已经在输入框里，这里只做最后的发送确认。
          await submitPrepared(page,selectors,signal,()=>{
            if(prepareOnly)return false;
            update({submittedPrompt:task.prompt});
            const quota=store.consumeQuota(account.id);update({quotaCharged:true,quotaDate:quota.date});
            return true;
          });
        } else if(!task.resume) await submitText(page,task.prompt,selectors,signal,(binding)=>{
          preparedBinding=binding;
          if(prepareOnly)return false;
          if(binding)update({submittedPrompt:binding.text,referenceBindings:binding.bindings});
          const quota=store.consumeQuota(account.id);update({quotaCharged:true,quotaDate:quota.date});
        },account.platform==='doubao'?task.references:null);
        if(prepareOnly)return {sent:false,mode:'executor-before-send',text:preparedBinding?.text||task.prompt,bindings:preparedBinding?.bindings||[],parameters:prepared?.parameters,uploadDiagnostics:prepared?.uploadDiagnostics,inputOrder:prepared?.inputOrder||inputOrder(),promptTyped:Boolean(prepared&&prepared.promptTyped)};
        const deadline=Date.now()+task.timeoutSeconds*1000;
        let anchorKey='',submittedDeadline=Date.now()+60000, confirmations=0,lastConfirmation='',lastReply='',stableSince=Date.now();
        // 我们发过的任务类消息（暖场 + 确认 + 催促）都要让页面归属检查认出来，不能算成“额外用户消息”。
        // 暖场消息渲染后可能被平台重新挂载（data 属性丢失、key 变化），只靠 baseline 会误判；
        // 续查任务时暖场消息来自任务记录。
        const persistedWarmup=task.warmup&&Array.isArray(task.warmup.messages)?task.warmup.messages:[];
        const warmupSources=warmupInfo&&Array.isArray(warmupInfo.messages)?warmupInfo.messages:persistedWarmup;
        const warmupTexts=warmupSources.map(item=>String(item&&item.text||'').trim()).filter(Boolean);
        const taskReplyTexts=[...warmupTexts];const confirmReplyTexts=[];
        let pushRounds=0,lastPushSource='',lastConfirmPhrase='',lastPushPhrase='';
        let lastUnderstoodKey='';let lastVerdict=null;let lastState=null;
        let media,ownership;
        while(Date.now()<deadline) {
          signal.throwIfAborted();
          // 弹窗挡住页面时先等它自己消失 / 等用户点掉，不抢着关窗口
          if(await visiblePopup(page)) await settlePopups(page,{signal,update,label:'页面弹窗'});
          if(task.nextPollAt>Date.now())await wait(task.nextPollAt-Date.now(),undefined,{signal});
          Object.assign(selectors,store.get(account.id)?.selectors || {});
          const state=await page.evaluate(readPageState,{selectors,baseline:before.keys,prompt:task.submittedPrompt||task.prompt,anchorKey,attachments:(task.references||[]).length,taskReplies:taskReplyTexts,confirmReplies:confirmReplyTexts});
          lastState=state;
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
          // 新回复稳定后，用理解器判断一次语义；模型不可用或未启用时完全退回下面的正则逻辑。
          if(interpreter && !state.responding && !state.generating && state.replies.length){
            const latest=state.replies[state.replies.length-1];
            const replyKey=String(latest.key||latest.id||'')+':'+String(latest.text||'').length;
            if(replyKey!==lastUnderstoodKey){
              lastUnderstoodKey=replyKey;
              lastVerdict=null;
              const understood=await interpreter.classify({
                task:{prompt:task.submittedPrompt||task.prompt,model:task.model,duration:task.duration,ratio:task.ratio,resolution:task.resolution},
                lastReply:latest.text,
                recentReplies:state.replies.slice(-10).map(reply=>reply.text),
                sent:taskReplyTexts,
                pushRounds,
              });
              if(understood){
                lastVerdict=understood;
                update({replyUnderstanding:{intent:understood.intent,confidence:understood.confidence,nextAction:understood.nextAction,evidence:understood.evidence,suggestedReply:understood.suggestedReply,at:new Date().toISOString()}});
              }
            }
          }
          const verdict=lastVerdict;
          const confident=Boolean(verdict&&verdict.confidence>=0.6);
          const suppressRegex=confident&&['wait','fail'].includes(verdict.nextAction);
          if(confident&&verdict.nextAction==='fail')throw new Error('平台拒绝：'+(verdict.evidence||state.text.slice(-1000)));
          const confirmByLlm=confident&&verdict.nextAction==='confirm'&&verdict.confidence>=0.75;
          const confirmByRegex=!suppressRegex&&state.confirmation;
          const confirmStable=confirmByLlm?Date.now()-stableSince>=4000:Date.now()-stableSince>=15000;
          if(!generating && !state.responding && !state.confirmationSent && confirmations===0 && !task.confirmationSentAt && !task.stopRequestedAt && (confirmByLlm||confirmByRegex) && confirmStable && state.text!==lastConfirmation) {
            confirmations++;
            const phrase=(confirmByLlm&&verdict.suggestedReply)||pickConfirmText(lastConfirmPhrase);lastConfirmPhrase=phrase;
            taskReplyTexts.push(phrase);confirmReplyTexts.push(phrase);
            update({confirmationSentAt:new Date().toISOString(),confirmationPhrase:phrase,confirmationSource:confirmByLlm?'ai':'rule',message:'方案回复已结束，正在确认生成视频'});
            update({status:'submitting',message:'平台方案已输出完成，确认并开始生成视频',progress:25});
            await submitText(page,phrase,selectors,signal);lastConfirmation=state.text;
          } else if(!generating && !state.responding && !state.confirmationSent && !task.confirmationSentAt && !task.stopRequestedAt) {
            const pushByLlm=confident&&verdict.nextAction==='push';
            const pushByRegex=!suppressRegex&&state.videoUnavailable;
            const pushStable=pushByLlm?Date.now()-stableSince>=4000:Date.now()-stableSince>=8000;
            if((pushByLlm||pushByRegex)&&pushRounds<3&&pushStable&&state.text!==lastPushSource){
              // 平台有时先回「暂时不能生成视频」来验证真人；继续用不同说法请求，最多 3 轮。
              pushRounds++;lastPushSource=state.text;
              const phrase=(pushByLlm&&verdict.suggestedReply)||pickPushText(lastPushPhrase);lastPushPhrase=phrase;
              taskReplyTexts.push(phrase);
              update({pushRounds,pushSource:pushByLlm?'ai':'rule',status:'submitting',message:'平台暂未同意生成（第 '+pushRounds+'/3 轮），正在再次请求生成视频',progress:25});
              await submitText(page,phrase,selectors,signal);
              stableSince=Date.now();lastReply='';
            }
          }
          if(task.generationWaitStartedAt){if(!task.nextPollAt||task.nextPollAt<=Date.now())update({nextPollAt:Date.now()+30000});}else await wait(1000,undefined,{signal});
        }
        if(!media) throw new Error('等待本次生成超时（已催促 '+pushRounds+' 轮）；未自动重复提交原始提示词');
        signal.throwIfAborted();update({status:'downloading',message:'下载并检查MP4完整性与时长',progress:90});
        const downloadsDir=typeof downloads==='function'?downloads():downloads;
        const destination=path.join(downloadsDir,task.id+'.mp4');
        const result=await downloadVideo({url:media.url,page,destination,signal,ffprobe,allowLocal:fixture,getDispatcher});
        signal.throwIfAborted();finished=true;
        return {...result,file:path.basename(result.path),watermarkMethod:media.method,ownership,downloadedAt:new Date().toISOString()};
      } catch(error){
        try{
          if(error&&typeof error==='object'){
            error.failureContext={
              lastReply:(lastState?.replies||[]).map(reply=>reply.text).join('\n').slice(-4000),
              pageText:String(lastState?.text||'').slice(-4000),
              flags:{confirmation:!!lastState?.confirmation,generating:!!lastState?.generating,quota:!!lastState?.quota,failure:!!lastState?.failure,refusal:!!lastState?.refusal,captcha:!!lastState?.captcha},
            };
          }
        }catch{/* 诊断上下文不是必需的 */}
        if(/Target page, context or browser has been closed|has been closed/i.test(String(error?.message||error))){
          const closed=new Error('账号浏览器窗口被关闭，任务已中断；遇到人工验证请直接在窗口里完成，不要关闭窗口');
          closed.failureContext=error?.failureContext;
          throw closed;
        }
        throw error;
      } finally {signal.removeEventListener('abort',abort);}
    } finally {
      // Keep failed pages available for diagnosis and manual login/verification.
      if(finished && page && !page.isClosed()) await page.close().catch(()=>{});
    }
  };
}
module.exports = { createExecutor, firstVisible, submitText, submitPrepared, inputOrder, uploadReferences, prepareInputs, applyOptions, resolveGeneratedMedia, selectorsFor, DOUBAO_DEFAULTS, settlePopups, visiblePopup, clickFirstText, warmUpConversation, waitForChatReply, CONFIRM_TEXTS, PUSH_TEXTS, makePhrasePicker };
