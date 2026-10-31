'use strict';
// 通用模型调用 + 回复理解 + 技能对话。只发送任务提示词 / 对话文本，
// 不发送账号、Cookie 或页面 HTML。技能按 stage 动态注入。
const {fetch}=require('undici');
const skillPacks=require('./skills');
const INTENTS=new Set(['confirm','soft_refuse','hard_refuse','ask_info','generating','done','other']);
const ACTIONS=new Set(['confirm','push','wait','fail']);
const FAILURE_CATEGORIES=new Set(['login','captcha','entry','upload','platform_refusal','quota','network','download','timeout','unknown']);
// 按模型的最大预算发送：上下文约 200k tokens，单次输出上限 10k。
// 中文大约 1 字 1–2 token，这里用字符数做保守截断，避免超过接口上限。
const MAX_CONTEXT_CHARS=120000;
const MAX_OUTPUT_TOKENS=10000;
const RECENT_REPLY_LIMIT=10;
const REPLY_CHARS=8000;
const PROMPT_CHARS=20000;

function endpoint(baseUrl,protocol='openai'){
  const base=String(baseUrl||'').trim().replace(/\/+$/,'');
  if(!base)return '';
  if(protocol==='anthropic'){
    if(/\/v1\/messages$/i.test(base))return base;
    return base+'/v1/messages';
  }
  if(/\/chat\/completions$/i.test(base))return base;
  let pathname='';
  try{pathname=new URL(base).pathname;}catch{return base+'/v1/chat/completions';}
  if(!pathname||pathname==='/')return base+'/v1/chat/completions';
  return base+'/chat/completions';
}

function truncate(value,limit){
  const text=String(value||'').replace(/\s+/g,' ').trim();
  return text.length>limit?text.slice(0,limit)+'…':text;
}

function buildPrompt({task={},lastReply='',recentReplies=[],sent=[],pushRounds=0,skills=[]}){
  const lines=[
    '你是视频生成任务的回复理解器。',
    '你会收到原始视频提示词、已发送的确认/催促消息、催促轮数，以及平台最新一条回复。',
    '判断平台当前意图，并给出下一步动作。只输出一个 JSON 对象，不要 Markdown、不要解释。',
    '字段：',
    'intent: confirm|soft_refuse|hard_refuse|ask_info|generating|done|other',
    'confidence: 0 到 1 的数字',
    'evidence: 支撑判断的回复原句，不超过 80 字',
    'next_action: confirm|push|wait|fail',
    'suggested_reply: 需要发送时给一条自然、口语化的中文消息，30 字以内，必须提到“生成视频”，不要链接、@、表情或引号',
    '规则：',
    '- confirm：平台在询问是否确认生成，或表示即将开始生成；next_action=confirm。',
    '- soft_refuse：平台暂时不能生成、让你换方式、只愿意写文字方案，但没有违规结论；next_action=push。',
    '- hard_refuse：内容违规、侵权、违反政策；next_action=fail。',
    '- ask_info：平台在问参数或内容细节；next_action=push，并在 suggested_reply 里用原提示词补一句。',
    '- generating/done：平台已经在生成或已经完成；next_action=wait。',
    '- 其余情况 intent=other, next_action=wait。',
  ];
  const extra=skillPacks.prompts(skills,'classify');
  if(extra.length)lines.push('额外要求：',...extra);
  const context={
    original_prompt:truncate(task.prompt,PROMPT_CHARS),
    parameters:{model:task.model||'',duration:task.duration??null,ratio:task.ratio||'',resolution:task.resolution||''},
    already_sent:(sent||[]).slice(-20),
    push_rounds:Number(pushRounds)||0,
    recent_replies:(recentReplies||[]).slice(-RECENT_REPLY_LIMIT).map(text=>truncate(text,REPLY_CHARS)),
    latest_reply:truncate(lastReply,PROMPT_CHARS),
  };
  let payload=JSON.stringify(context,null,2);
  if(payload.length>MAX_CONTEXT_CHARS)payload=payload.slice(0,MAX_CONTEXT_CHARS)+'\n…（上下文过长，已截断）';
  return {system:lines.join('\n'),user:payload+'\n\n只输出 JSON。'};
}

function buildChatPrompt({message='',history=[],skills=[]}){
  const base='你是 AI 视频创作专家，专注把想法做成视频。回答简短、具体、口语化，不冒充通用助手。';
  const lines=[base,...skillPacks.prompts(skills,'chat')];
  const transcript=(history||[]).slice(-20).map(turn=>{
    const role=turn&&turn.role==='assistant'?'助手':'用户';
    return role+'：'+truncate(turn&&turn.text,4000);
  }).join('\n');
  const user=(transcript?transcript+'\n':'')+'用户：'+truncate(message,4000);
  return {system:lines.join('\n'),user};
}

function cleanSuggested(value){
  const text=String(value||'').replace(/\s+/g,' ').trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g,'');
  if(!text||text.length>40)return '';
  if(/https?:\/\/|www\.|@\S|#\S|[\u{1F300}-\u{1FAFF}]/u.test(text))return '';
  if(!/生成视频|生成/.test(text))return '';
  return text;
}

function parseVerdict(text){
  const raw=String(text||'').replace(/```(?:json)?/gi,'');
  const start=raw.indexOf('{'),end=raw.lastIndexOf('}');
  if(start<0||end<=start)return null;
  let data;
  try{data=JSON.parse(raw.slice(start,end+1));}catch{return null;}
  if(!data||!INTENTS.has(data.intent))return null;
  const confidence=Number(data.confidence);
  if(!Number.isFinite(confidence))return null;
  if(!ACTIONS.has(data.next_action))return null;
  return {
    intent:data.intent,
    confidence:Math.max(0,Math.min(1,confidence)),
    nextAction:data.next_action,
    evidence:truncate(data.evidence,160),
    suggestedReply:cleanSuggested(data.suggested_reply),
  };
}

async function requestModel(settings,getDispatcher,{system='',user='',maxTokens=MAX_OUTPUT_TOKENS}={}){
  const cfg=(settings&&settings.value&&settings.value.interpreter)||{};
  if(!cfg.enabled)return {text:'',truncated:false,error:'AI 回复理解未启用'};
  if(!cfg.baseUrl||!cfg.model)return {text:'',truncated:false,error:'AI 回复理解缺少 Base URL 或模型'};
  const key=cfg.apiKey||'';
  if(!key)return {text:'',truncated:false,error:'AI 回复理解缺少 API Key'};
  const url=endpoint(cfg.baseUrl,cfg.protocol);
  const headers={'Content-Type':'application/json'};
  let body;
  if(cfg.protocol==='anthropic'){
    headers['x-api-key']=key;headers['anthropic-version']='2023-06-01';
    body={model:cfg.model,max_tokens:maxTokens,temperature:0,system,messages:[{role:'user',content:user}],thinking:{type:'disabled'}};
  }else{
    headers.Authorization='Bearer '+key;
    body={model:cfg.model,temperature:0,max_tokens:maxTokens,messages:[{role:'system',content:system},{role:'user',content:user}]};
  }
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(new Error('AI 回复理解超时')),Number(cfg.timeoutMs)||8000);
  try{
    const res=await fetch(url,{method:'POST',headers,body:JSON.stringify(body),signal:controller.signal,dispatcher:getDispatcher?getDispatcher(url):undefined});
    const text=await res.text();
    if(!res.ok)return {text:'',truncated:false,error:'AI 回复理解 HTTP '+res.status+'：'+truncate(text,200)};
    let payload;
    try{payload=JSON.parse(text);}catch{return {text:'',truncated:false,error:'AI 回复理解返回的不是 JSON'};}
    const content=cfg.protocol==='anthropic'
      ? (Array.isArray(payload.content)?payload.content.map(block=>block&&block.text||'').join(''):'')
      : (payload.choices&&payload.choices[0]&&payload.choices[0].message&&payload.choices[0].message.content)||'';
    const truncated=cfg.protocol==='anthropic'
      ? payload.stop_reason==='max_tokens'
      : Boolean(payload.choices&&payload.choices[0]&&payload.choices[0].finish_reason==='length');
    return {text:content,truncated,error:''};
  }catch(error){
    const message=error&&error.name==='AbortError'?'超时':String((error&&error.message)||error);
    return {text:'',truncated:false,error:'AI 回复理解调用失败：'+message};
  }finally{clearTimeout(timer);}
}

async function classifyDetailed(settings,getDispatcher,input={}){
  const {system,user}=buildPrompt(input);
  const response=await requestModel(settings,getDispatcher,{system,user});
  if(response.error)return {verdict:null,error:response.error};
  const verdict=parseVerdict(response.text);
  if(!verdict)return {verdict:null,error:(response.truncated?'模型输出被截断（thinking 可能占用过多 tokens）：':'模型没有返回可解析的判定：')+truncate(response.text,200)};
  return {verdict,error:''};
}

async function chatDetailed(settings,getDispatcher,{message='',history=[],skills=[]}={}){
  const {system,user}=buildChatPrompt({message,history,skills});
  const response=await requestModel(settings,getDispatcher,{system,user});
  if(response.error)return {reply:'',error:response.error};
  const reply=String(response.text||'').trim();
  if(!reply)return {reply:'',error:response.truncated?'模型输出被截断':'模型没有返回内容'};
  return {reply,error:response.truncated?'模型输出被截断，回复可能不完整':''};
}

function buildFailurePrompt({task={},account={},error={},lastReply='',pageText='',flags={}}={}){
  const lines=[
    '你是视频生成任务的失败诊断助手。',
    '根据原始提示词、平台、账号、失败阶段、原始错误、页面最后的回复和页面状态，判断最可能的失败原因。',
    '只输出一个 JSON 对象，不要 Markdown、不要解释。',
    '字段：',
    'category: login|captcha|entry|upload|platform_refusal|quota|network|download|timeout|unknown',
    'reason: 一句面向用户的中文原因，不超过 80 字',
    'advice: 一句可执行建议，不超过 60 字',
    'confidence: 0 到 1 的数字',
    '要求：优先根据原始错误和页面状态判断；没有足够信息就用 unknown，不要编造平台没有说过的内容。',
  ];
  const context={
    platform:task.platform||'',
    account:account.name||task.accountId||'',
    stage:task.status||'',
    prompt:truncate(task.submittedPrompt||task.prompt,4000),
    raw_error:truncate(error&&error.message||error,3000),
    last_reply:truncate(lastReply,4000),
    page_text:truncate(pageText,4000),
    flags:flags||{},
    upload_diagnostics:task.uploadDiagnostics||null,
    conversation_url:task.conversationURL||'',
  };
  let payload=JSON.stringify(context,null,2);
  if(payload.length>MAX_CONTEXT_CHARS)payload=payload.slice(0,MAX_CONTEXT_CHARS)+'\n…（上下文过长，已截断）';
  return {system:lines.join('\n'),user:payload+'\n\n只输出 JSON。'};
}

function parseFailureAnalysis(text){
  const raw=String(text||'').replace(/```(?:json)?/gi,'');
  const start=raw.indexOf('{'),end=raw.lastIndexOf('}');
  if(start<0||end<=start)return null;
  let data;
  try{data=JSON.parse(raw.slice(start,end+1));}catch{return null;}
  if(!data||!FAILURE_CATEGORIES.has(data.category))return null;
  const reason=truncate(data.reason,120);
  if(!reason)return null;
  const confidence=Number(data.confidence);
  return {
    category:data.category,
    reason,
    advice:truncate(data.advice,100),
    confidence:Number.isFinite(confidence)?Math.max(0,Math.min(1,confidence)):0.5,
  };
}

async function analyzeFailureDetailed(settings,getDispatcher,input={}){
  const {system,user}=buildFailurePrompt(input);
  const response=await requestModel(settings,getDispatcher,{system,user});
  if(response.error)return {analysis:null,error:response.error};
  const analysis=parseFailureAnalysis(response.text);
  if(!analysis)return {analysis:null,error:'模型没有返回可解析的失败诊断：'+truncate(response.text,200)};
  return {analysis,error:''};
}

function createInterpreter({settings,getDispatcher}){
  return {
    enabled(){return Boolean(settings&&settings.value&&settings.value.interpreter&&settings.value.interpreter.enabled);},
    classify(input){return classifyDetailed(settings,getDispatcher,input).then(result=>result.verdict);},
    classifyDetailed(input){return classifyDetailed(settings,getDispatcher,input);},
    chat(input){return chatDetailed(settings,getDispatcher,input).then(result=>result.reply);},
    chatDetailed(input){return chatDetailed(settings,getDispatcher,input);},
    analyzeFailure(input){return analyzeFailureDetailed(settings,getDispatcher,input).then(result=>result.analysis);},
    analyzeFailureDetailed(input){return analyzeFailureDetailed(settings,getDispatcher,input);},
  };
}

module.exports={createInterpreter,endpoint,buildPrompt,buildChatPrompt,buildFailurePrompt,parseVerdict,parseFailureAnalysis,cleanSuggested,classifyDetailed,chatDetailed,analyzeFailureDetailed,requestModel};
