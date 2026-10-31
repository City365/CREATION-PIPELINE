'use strict';
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let noticeTimer,busy=false,agentHistory=[];
function notice(message,error=false){const n=$('#notice');n.textContent=message;n.classList.toggle('error',error);n.hidden=false;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>n.hidden=true,error?9000:4500);}
async function api(url,options={}){const r=await fetch(url,{...options,headers:{'Content-Type':'application/json',...options.headers}});let data;try{data=await r.json();}catch{throw new Error('服务返回无效响应');}if(!r.ok)throw new Error(data.error||'请求失败：'+r.status);return data;}
function on(sel,event,fn){$(sel)?.addEventListener(event,fn);}
async function action(button,fn){const old=button?.disabled;if(button)button.disabled=true;try{return await fn();}catch(e){notice(e.message,true);}finally{if(button)button.disabled=old||false;}}
const INTENT_LABEL={confirm:'请求确认',soft_refuse:'软拒绝',hard_refuse:'硬拒绝',ask_info:'询问信息',generating:'生成中',done:'已完成',other:'其他'};
const ACTION_LABEL={confirm:'确认生成',push:'继续请求',wait:'等待',fail:'停止'};

function mode(){return $('#chat-mode').value;}
function selectedSkills(){return $$('#skill-pills input:checked').map(input=>input.dataset.skill);}
function accountName(){const select=$('#test-account');return select.selectedOptions[0]?.textContent||select.value||'豆包';}
function accountId(){return $('#test-account').value;}
function chatLog(){return $('#chat-log');}
function scrollToEnd(){const log=chatLog();log.scrollTop=log.scrollHeight;}
function removeEmpty(){$('#chat-empty')?.remove();}
function emptyHtml(){
  return mode()==='agent'
    ? '<div class="chat-empty" id="chat-empty"><span class="chat-empty-icon"><svg class="icon" aria-hidden="true"><use href="#i-spark"/></svg></span><h3>和智能体聊点什么</h3><p>勾选「正常对话」让它按 AI 视频创作专家的身份回复；勾选「语义理解」还会给出判定。</p></div>'
    : '<div class="chat-empty" id="chat-empty"><span class="chat-empty-icon"><svg class="icon" aria-hidden="true"><use href="#i-spark"/></svg></span><h3>选一个账号，开始聊</h3><p>这里只发普通对话。勾选「语义理解」看判定，勾选「正常对话」拿到建议回复。</p></div>';
}
function resetLog(){
  chatLog().innerHTML=emptyHtml();
  agentHistory=[];
  $('#test-state').textContent='Enter 发送 · Shift + Enter 换行';
}
function verdictHtml(verdict,error,showSuggestion=true){
  if(!verdict){
    return '<div class="chat-verdict error"><div class="verdict-head"><span class="verdict-title">系统判定</span><span class="badge muted">没有判定</span></div><p>'+(error?('理解器错误：'+esc(error)):'回复无法解析，任务会退回内置规则。')+'</p></div>';
  }
  const head=[
    '<span class="verdict-title">系统判定</span>',
    '<span class="badge">'+esc(INTENT_LABEL[verdict.intent]||verdict.intent)+'</span>',
    '<span class="badge muted">置信度 '+Math.round((verdict.confidence||0)*100)+'%</span>',
    '<span class="badge '+(verdict.nextAction==='fail'?'error':verdict.nextAction==='confirm'?'active':'warn')+'">下一步：'+esc(ACTION_LABEL[verdict.nextAction]||verdict.nextAction)+'</span>',
  ];
  let body='';
  if(showSuggestion&&verdict.suggestedReply)body+='<p><strong>建议回复：</strong>'+esc(verdict.suggestedReply)+'</p>';
  if(verdict.evidence)body+='<p><strong>判定依据：</strong>'+esc(verdict.evidence)+'</p>';
  if(showSuggestion&&verdict.suggestedReply)body+='<button class="quiet verdict-use" type="button" data-use-reply="'+esc(verdict.suggestedReply)+'">用它回复</button>';
  return '<div class="chat-verdict"><div class="verdict-head">'+head.join('')+'</div>'+body+'</div>';
}
function appendUser(text){removeEmpty();const bubble=document.createElement('div');bubble.className='chat-bubble user';bubble.textContent=text;chatLog().append(bubble);scrollToEnd();}
function appendAssistant(reply,who){
  const bubble=document.createElement('div');bubble.className='chat-bubble assistant';
  const role=document.createElement('span');role.className='chat-role';role.textContent=who;
  const body=document.createElement('div');body.textContent=reply;
  bubble.append(role,body);chatLog().append(bubble);scrollToEnd();
}
function appendVerdict(verdict,error){
  const wrap=document.createElement('div');wrap.innerHTML=verdictHtml(verdict,error,selectedSkills().includes('chat'));
  chatLog().append(wrap.firstElementChild);scrollToEnd();
}
function appendTyping(who){
  const bubble=document.createElement('div');bubble.className='chat-bubble assistant';
  const role=document.createElement('span');role.className='chat-role';role.textContent=who+' 正在回复';
  const dots=document.createElement('span');dots.className='chat-typing';dots.innerHTML='<i></i><i></i><i></i>';
  bubble.append(role,dots);chatLog().append(bubble);scrollToEnd();return bubble;
}
function setBusy(next){busy=next;$('#chat-input').disabled=next;$('#test-send').disabled=next;}
function autoGrow(){const input=$('#chat-input');input.style.height='auto';input.style.height=Math.min(140,input.scrollHeight)+'px';}
function resetComposer(){const input=$('#chat-input');input.value='';autoGrow();}

async function sendMessage(){
  if(busy)return;
  const message=$('#chat-input').value.trim();
  if(!message){notice('先输入测试消息');$('#chat-input').focus();return;}
  const agent=mode()==='agent';
  if(!agent&&!accountId()){notice('先选择一个豆包测试账号');return;}
  const name=agent?'智能体':accountName();
  const skills=selectedSkills();
  appendUser(message);resetComposer();setBusy(true);
  $('#test-state').textContent='已发送，等待回复…（最长约 2 分钟）';
  const typing=appendTyping(name);
  try{
    let result;
    if(agent){
      result=await api('/api/agent/chat',{method:'POST',body:JSON.stringify({message,history:agentHistory.slice(-20),skills})});
      agentHistory.push({role:'user',text:message},{role:'assistant',text:result.reply});
    }else{
      result=await api('/api/accounts/'+accountId()+'/chat-test',{method:'POST',body:JSON.stringify({message,skills})});
    }
    typing.remove();
    appendAssistant(result.reply,name);
    if(result.verdict)appendVerdict(result.verdict,'');
    else if(result.interpreterError&&skills.includes('intent'))appendVerdict(null,result.interpreterError);
    $('#test-state').textContent='已收到回复，可以继续';
  }catch(error){
    typing.remove();
    appendVerdict(null,error.message);
    $('#test-state').textContent='请求失败，可以重试';
  }finally{setBusy(false);$('#chat-input').focus();}
}

function applyMode(){
  const agent=mode()==='agent';
  $('#account-field').hidden=agent;
  const close=$('#test-close');if(close)close.hidden=agent;
  resetLog();
  const input=$('#chat-input');
  input.placeholder=agent?'和智能体聊点什么，比如：帮我做个橘猫视频':'和「'+accountName()+'」聊点什么，比如：帮我生成一个橘猫视频';
  input.disabled=false;$('#test-send').disabled=false;
  input.focus();
}
async function loadSkills(){
  const r=await api('/api/skills');
  let saved=null;try{saved=JSON.parse(localStorage.getItem('creative-desk-skills')||'null');}catch{}
  $('#skill-pills').innerHTML=(r.skills||[]).map(skill=>{
    const checked=!saved||saved.includes(skill.id);
    return '<label class="skill-pill" title="'+esc(skill.description||'')+'"><input type="checkbox" data-skill="'+esc(skill.id)+'"'+(checked?' checked':'')+'>'+esc(skill.name)+'</label>';
  }).join('');
  $('#skill-pills').addEventListener('change',()=>{
    try{localStorage.setItem('creative-desk-skills',JSON.stringify(selectedSkills()));}catch{}
  });
}
async function loadAccounts(){
  const s=await api('/api/state');
  const status=$('#service-status');if(status)status.textContent='服务已连接';
  $('.header-status')?.classList.remove('offline');
  const accounts=(s.accounts||[]).filter(a=>a.platform==='doubao');
  const select=$('#test-account');const current=select.value;
  select.innerHTML=accounts.length?accounts.map(a=>'<option value="'+a.id+'">'+esc(a.name)+(a.enabled===false?'（已停用）':'')+'</option>').join(''):'<option value="">没有豆包账号</option>';
  if(current&&accounts.some(a=>a.id===current))select.value=current;
  if(mode()==='doubao'&&accounts.length){
    const input=$('#chat-input');
    if(!busy){input.disabled=false;$('#test-send').disabled=false;input.placeholder='和「'+accountName()+'」聊点什么，比如：帮我生成一个橘猫视频';}
  }
}

on('#chat-mode','change',applyMode);
on('#chat-form','submit',e=>{e.preventDefault();sendMessage();});
on('#test-account','change',()=>{const input=$('#chat-input');input.placeholder='和「'+accountName()+'」聊点什么，比如：帮我生成一个橘猫视频';input.focus();});
on('#chat-input','keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('#chat-form').requestSubmit();}});
on('#chat-input','input',autoGrow);
on('#chat-log','click',e=>{const button=e.target.closest('[data-use-reply]');if(!button)return;const input=$('#chat-input');input.value=button.dataset.useReply;autoGrow();input.focus();});
on('#test-clear','click',()=>{resetLog();notice('记录已清空；账号窗口里的会话仍保留');});
on('#test-close','click',e=>action(e.currentTarget,async()=>{
  const id=accountId();if(!id)throw new Error('先选择一个账号');
  await api('/api/accounts/'+id+'/close',{method:'POST',body:'{}'});
  $('#test-state').textContent='账号窗口已关闭；下次测试会重新打开';
  notice('账号窗口已关闭');
}));
Promise.all([loadSkills(),loadAccounts()]).then(()=>applyMode()).catch(error=>{const status=$('#service-status');if(status)status.textContent='服务未连接';$('.header-status')?.classList.add('offline');notice(error.message,true);});
setInterval(()=>loadAccounts().catch(()=>{}),15000);
