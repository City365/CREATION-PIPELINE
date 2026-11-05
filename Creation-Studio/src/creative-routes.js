'use strict';
const fs=require('node:fs');const path=require('node:path');const store=require('./creative-store');const scene=require('./scene-model');const channels=require('./channels');const providers=require('./providers');

const VIEWS=[['front','正视'],['side','侧视'],['back','反视'],['top','俯视']];
// 四台机位的硬说明：放在出图提示词最前面，避免长提示词里机位被忽略、四张画成一个样。
const SCENE_CAMERA_LINES={
 front:'【本图机位】站在南侧墙前朝北看（camera at the south wall, looking north, +y）：水平建筑摄影，视线高约 1.6 米，画角约 70°；画面左=西、右=东，远端是北墙。',
 back:'【本图机位】站在北墙前朝南看（camera at the north wall, looking south, -y）：水平建筑摄影，视线高约 1.6 米，画角约 70°；画面左=东、右=西，远端是南墙；北墙与靠北的家具在相机身后，不可见。',
 side:'【本图机位】站在西墙前朝东看（camera at the west wall, looking east, +x）：水平建筑摄影，视线高约 1.6 米，画角约 70°；画面左=北、右=南，远端是东墙；西墙与靠西的家具在相机身后，不可见。',
 top:'【本图机位】镜头垂直向下俯视（top-down orthographic, looking down, -z）：正交投影、移除屋顶与吊顶；画面上方=北、右方=东，覆盖整个室内边界。',
};
const SCENE_DESCRIBE_SYSTEM='你是场景美术指导。根据一张场景图，用中文写一段可复用的场景描述：空间用途与尺度感、墙地顶材质与颜色、门窗位置与朝向、主要家具与摆放关系、陈设装饰、光线时间与色调、镜头视角、整体风格。只输出描述正文，200-400字，一段话，不分点，不写“这是一张图”之类的元描述。';
// 四视图提示词已改由后端智能体按「场景4视图反推」技能推理，这里不再保留系统提示。
function pickJson(text){
 const s=String(text||'').replace(/```(?:json)?/gi,'');const start=s.indexOf('{'),end=s.lastIndexOf('}');
 if(start<0||end<=start)throw Error('模型没有返回可解析的 JSON，请重试');
 return JSON.parse(s.slice(start,end+1));
}
function protocolOf(ch){return ch.type==='gemini'?'gemini':ch.type==='openai-responses'?'responses':'chat';}
function llmChannel(id){
 const ch=id?channels.get('llm',id):channels.active('llm');
 if(!ch||ch.enabled===false)throw Error('请选择可用的推理模型');
 return ch;
}

/* ---------------- 场景四视图：交给后端智能体按技能推理 ----------------
 * 技能装在后端 agent_backend/skills/场景4视图反推（dir:场景4视图反推），
 * 这里只负责：建临时会话 → 带着 skill_id 发一轮 → 解析 SSE → 从技能模板里抽出五条提示词。
 * 不再用一行系统提示直接问模型。
 */
const AGENT_URL=String(process.env.WMD_AGENT_URL||'http://127.0.0.1:17820').replace(/\/+$/,'');
const SCENE_SKILL_ID='dir:场景4视图反推';
const SCENE_SKILL_NAME='场景4视图反推';
const SCENE_AGENT_TIMEOUT=Number(process.env.WMD_SCENE_AGENT_TIMEOUT)||300000;

function sceneAgentModel(channelId){
 if(!channelId)return '';
 const ch=channels.get('llm',channelId);
 return ch&&ch.model?('studio-'+ch.id+':'+ch.model):'';
}

function sceneAgentSessionId(){
 return 'scene-4v-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8);
}

function sceneAgentUnreachable(error){
 const codes=[];const seen=new Set();
 const walk=(item)=>{
  if(!item||typeof item!=='object'||seen.has(item))return;
  seen.add(item);
  if(item.code)codes.push(String(item.code));
  if(Array.isArray(item.errors))item.errors.forEach(walk);
  if(item.cause)walk(item.cause);
 };
 walk(error);
 const text=String((error&&error.message)||'');
 return codes.some((code)=>['ECONNREFUSED','ENOTFOUND','EAI_AGAIN','ECONNRESET','UND_ERR_SOCKET','EPIPE','UND_ERR_CONNECT_TIMEOUT'].includes(code))
  ||/fetch failed|socket hang up|connect ECONNREFUSED/i.test(text);
}
function sceneAgentError(error){
 if(sceneAgentUnreachable(error))return Object.assign(Error('智能体后端没有响应（'+AGENT_URL+'），先运行 start-agent.cmd 再重试'),{status:502});
 return error;
}

async function sceneAgentJson(pathname,{method='GET',project='',body=null}={}){
 let res;
 try{
  res=await fetch(AGENT_URL+pathname,{method,headers:{'X-Project-Id':project,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 }catch(error){throw sceneAgentError(error);}
 const data=await res.json().catch(()=>null);
 if(!res.ok){
  const detail=(data&&(data.detail||data.error))||('HTTP '+res.status);
  throw Object.assign(Error('智能体接口 '+pathname+' 失败：'+(typeof detail==='string'?detail:JSON.stringify(detail))),{status:502});
 }
 return data;
}

async function sceneAgentOpen(project,sid){
 await sceneAgentJson('/agent/sessions/'+encodeURIComponent(sid),{method:'PUT',project,body:{id:sid,title:'场景四视图',pinned:false,updated:Date.now(),messages:[]}});
}
async function sceneAgentClose(project,sid){
 try{await sceneAgentJson('/agent/sessions/'+encodeURIComponent(sid),{method:'DELETE',project});}catch{/* 会话可能还在跑，留着不影响 */ }
}

/** 发一轮对话并读完 SSE：返回最终正文、用到的工具、是否被反问打断 */
async function sceneAgentAsk({project,sid,text,modelId='',timeoutMs=SCENE_AGENT_TIMEOUT}){
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{
  let res;
  try{
   res=await fetch(AGENT_URL+'/agent/chat',{
    method:'POST',
    headers:{'Content-Type':'application/json','X-Project-Id':project},
    body:JSON.stringify({session_id:sid,text,skill:SCENE_SKILL_NAME,skill_id:SCENE_SKILL_ID,permission:'readonly',...(modelId?{model_id:modelId}:{})}),
    signal:controller.signal,
   });
  }catch(error){throw sceneAgentError(error);}
  if(!res.ok||!res.body){
   const data=await res.json().catch(()=>null);
   const detail=(data&&(data.detail||data.error))||('HTTP '+res.status);
   throw Object.assign(Error('智能体调用失败：'+(typeof detail==='string'?detail:JSON.stringify(detail))),{status:502});
  }
  let answer='',error='',choice=null,done=false;
  const tools=[];
  const decoder=new TextDecoder();
  let buffer='';
  for await (const chunk of res.body){
   buffer+=decoder.decode(chunk,{stream:true});
   let cut;
   while((cut=buffer.indexOf('\n\n'))>=0){
    const raw=buffer.slice(0,cut);buffer=buffer.slice(cut+2);
    const line=raw.split('\n').find((l)=>l.startsWith('data: '));
    if(!line)continue;
    let evt;try{evt=JSON.parse(line.slice(6));}catch{continue;}
    if(evt.type==='delta'&&evt.text)answer+=String(evt.text);
    else if(evt.type==='replace')answer=String(evt.text||'');
    else if(evt.type==='error')error=String(evt.message||'智能体返回错误');
    else if(evt.type==='choice')choice=evt;
    else if(evt.type==='tool_call'&&evt.tool)tools.push(String(evt.tool));
    else if(evt.type==='done')done=true;
   }
  }
  if(error)throw Object.assign(Error(error),{status:502});
  if(choice&&!answer.trim()){
   const q=(choice.questions&&choice.questions[0]&&choice.questions[0].question)||choice.question||'';
   throw Object.assign(Error('智能体改成反问用户（'+String(q).slice(0,60)+'），没有按技能直接输出；请重试'),{status:502});
  }
  if(!answer.trim()){
   const out=await res.json().catch(()=>null);
   void out;
   throw Object.assign(Error('智能体没有返回内容'+(done?'':'（流中断）')),{status:502});
  }
  return {answer,tools,done};
 } finally { clearTimeout(timer); }
}

/** 技能输出是 Markdown 的 A/B/C/D，这里把 D 里的五条提示词抽出来 */
function sceneMarkdownSections(text){
 const out=[];let cur=null;
 for(const line of String(text||'').replace(/\r\n/g,'\n').split('\n')){
  const m=/^#{1,6}\s*(.+?)\s*$/.exec(line);
  if(m){cur={title:m[1],lines:[]};out.push(cur);continue;}
  if(cur)cur.lines.push(line);
 }
 return out;
}
function sceneFirstBlock(lines){
 const body=Array.isArray(lines)?lines.join('\n'):String(lines||'');
 const fenced=/```(?:text|markdown|md)?\s*\n([\s\S]*?)```/i.exec(body);
 if(fenced&&fenced[1].trim())return fenced[1].trim();
 const plain=body.split('\n').map((line)=>line.trim()).filter(Boolean);
 return plain.length?plain.join('\n').trim():'';
}
const SCENE_VIEW_MATCH=[['front',/正视/],['back',/反视/],['side',/侧视/],['top',/俯视/]];

function sceneParseSkillOutput(text){
 const raw=String(text||'');
 // 智能体偶尔还是按老格式回 JSON，先兜一层
 try{
  const parsed=pickJson(raw);
  if(parsed&&Array.isArray(parsed.views)&&parsed.views.length){
   const views=VIEWS.map(([id,label])=>({id,label,prompt:String((parsed.views.find((v)=>String(v.id)===id)||{}).prompt||'').trim()}));
   if(views.every((v)=>v.prompt))return {summary:String(parsed.summary||''),views,composite:'',form:'json'};
  }
 }catch{/* 不是 JSON，按技能模板解析 */ }
 const sections=sceneMarkdownSections(raw);
 const found={};
 let composite='',summary='';
 for(const section of sections){
  const title=section.title;
  if(/合集|2\s*[×x]\s*2/i.test(title)&&!composite)composite=sceneFirstBlock(section.lines);
  const hit=SCENE_VIEW_MATCH.find(([,re])=>re.test(title));
  if(hit&&!found[hit[0]])found[hit[0]]=sceneFirstBlock(section.lines);
  if(/坐标系/.test(title)&&section.lines.length){
   // 智能体常把字段写成 **场景名称**：xxx，先去掉强调符号再取
   const body=section.lines.join('\n').replace(/[*_`]/g,'');
   const pick=(label)=>{const m=new RegExp('(?:^|\\n)\\s*'+label+'\\s*[:：]\\s*(.+)').exec(body);return m?String(m[1]).trim():'';};
   summary=[pick('场景名称'),pick('空间尺寸'),pick('统一外观与光照')].filter(Boolean).map((s)=>s.replace(/[（(][^）)]*[）)]/g,'').trim()).join(' · ').slice(0,140);
  }
 }
 if(!Object.keys(found).length){
  // 没有小标题：按代码块顺序兜：合集 + 四条
  const blocks=[...raw.matchAll(/```(?:text|markdown|md)?\s*\n([\s\S]*?)```/gi)].map((m)=>m[1].trim()).filter(Boolean);
  if(blocks.length>=5){composite=blocks[0];['front','back','side','top'].forEach((id,i)=>{found[id]=blocks[i+1];});}
  else if(blocks.length===4){['front','back','side','top'].forEach((id,i)=>{found[id]=blocks[i];});}
  else throw Object.assign(Error('智能体没有按技能模板输出（找不到 A/B/C/D 与四条机位提示词），请重试'),{status:502});
 }
 const views=VIEWS.map(([id,label])=>({id,label,prompt:String(found[id]||'').trim()}));
 if(views.some((v)=>!v.prompt)){
  const missing=views.filter((v)=>!v.prompt).map((v)=>v.label).join('、');
  throw Object.assign(Error('智能体输出缺少机位提示词：'+missing+'；请重试'),{status:502});
 }
 return {summary,views,composite,form:'markdown'};
}

function sceneAgentPrompt(name,description){
 return [
  '请用「场景4视图反推」技能完成这次场景设计，按技能规定的模板直接输出完整结果（A 坐标系 / B 对象表 / C 摄像机 / D 五条提示词）。',
  '直接输出结果，不要向我提问、不要征求确认、不要只给大纲。',
  '场景名称：'+String(name||'未命名场景').trim(),
  '场景描述：'+String(description||'').trim(),
 ].join('\n');
}

/* 智能体推理一次要好几分钟，连接断了（服务重启/超时）不能把结果一起丢掉：
   按「项目 + 画面条目」把最后一次结果落盘，前端失败时可以取回。 */
const SCENE_CACHE_DIR=()=>path.join(require('./config').load().dataDir||require('./config').DATA,'scene-view-prompts');
function sceneCacheFile(project,itemId){
 const safe=(value)=>String(value||'').replace(/[^\w.-]+/g,'_').slice(0,120)||'_';
 return path.join(SCENE_CACHE_DIR(),safe(project)+'__'+safe(itemId)+'.json');
}
function sceneCacheWrite(project,itemId,payload){
 if(!project||!itemId)return;
 try{
  fs.mkdirSync(SCENE_CACHE_DIR(),{recursive:true});
  fs.writeFileSync(sceneCacheFile(project,itemId),JSON.stringify({...payload,itemId,projectId:project,at:Date.now()},null,2),'utf8');
 }catch{/* 缓存失败不影响正常返回 */}
}
function sceneCacheRead(project,itemId){
 if(!project||!itemId)return null;
 try{return JSON.parse(fs.readFileSync(sceneCacheFile(project,itemId),'utf8'));}catch{return null;}
}

/** 四视图提示词：全部由智能体按技能推理，不再直连模型 */
async function sceneViewPromptsByAgent({project,name,description,channelId,itemId}){
 const sid=sceneAgentSessionId();
 try{
  await sceneAgentOpen(project,sid);
  const {answer,tools}=await sceneAgentAsk({project,sid,text:sceneAgentPrompt(name,description),modelId:sceneAgentModel(channelId)});
  const parsed=sceneParseSkillOutput(answer);
  const result={...parsed,raw:answer.length>20000?answer.slice(0,20000):answer,agent:{session:sid,skill:SCENE_SKILL_ID,tools,model:sceneAgentModel(channelId)||'default'}};
  sceneCacheWrite(project,itemId,result);
  return result;
 } finally { await sceneAgentClose(project,sid); }
}

module.exports=async function creative(req,res,url,ctx){ if(!url.pathname.startsWith('/api/creative/'))return false;
 const {ok,bad,readBody,mediaPath,imageDataUrl}=ctx;const method=req.method;const body=method==='GET'?{}:await readBody(req);const project=String(body.projectId||url.searchParams.get('projectId')||'default');const scope=String(ctx.user?.id||'local')+':'+project;
 try {
 const match=/^\/api\/creative\/documents\/(scene|image)$/.exec(url.pathname);
 if(match){const kind=match[1];if(method==='GET'){const id=url.searchParams.get('id');ok(res,id?store.get(kind,scope,id):store.all(kind,scope).map(({id,name,revision,updatedAt})=>({id,name,revision,updatedAt})));return true;}
 if(method==='POST'){const doc=body.document;if(!doc||typeof doc.name!=='string'||doc.name.length>120)throw Error('文档名称无效');if(kind==='scene')doc.report=scene.validate(doc.model);if(kind==='image'){const data=doc.layers;if(!data?.info||!Array.isArray(data.layers)||!Array.isArray(data.data)||data.layers.length>300)throw Error('图层工程无效');for(const n of [data.info.width,data.info.height])if(!Number.isInteger(n)||n<1||n>16384)throw Error('图层工程尺寸无效');}ok(res,store.save(kind,scope,doc));return true;}}
 if(url.pathname==='/api/creative/scene/example'){ok(res,{model:scene.example()});return true;}
 if(url.pathname==='/api/creative/scene/validate'){ok(res,{report:scene.validate(body.model),prompts:scene.prompts(body.model)});return true;}
 if(url.pathname==='/api/creative/scene/analyze'&&method==='POST'){
 const ch=body.channelId?channels.get('llm',body.channelId):channels.active('llm');if(!ch||ch.enabled===false)throw Error('请选择可用的推理模型');
 if(!String(body.description||'').trim())throw Error('请填写场景描述');
 const references=body.references||[];if(!Array.isArray(references)||references.length>8)throw Error('最多8张参考图');
 const rules=fs.readFileSync(path.join(__dirname,'resources','scene-spatial-rules.md'),'utf8');
 const system='你是场景空间建模助手。'+rules+'\n只返回一个JSON对象，不使用Markdown。结构严格为 '+JSON.stringify(scene.example())+'。示例仅定义字段，必须根据用户输入重新推理，不套用示例尺寸和家具。source/assumptions记录观察、推定及缺失信息。position为中心底部xyz，size为宽深高；rotation为度。门窗使用openings。未知或被遮挡区域明确标为推定。不要把图像估计写成测量值。每件对象添加collisionMode，普通家具solid；贴地且不超过0.05米厚的地毯用surface。桌上物体必须给parentId引用桌子。保持既有对象ID和锁定对象不变。';
 const content=[{type:'text',text:'场景名称：'+String(body.name||'未命名场景')+'\n场景描述：'+body.description+(body.previous?'\n当前模型：'+JSON.stringify(body.previous):'')}];
 for(const ref of references)content.push({type:'text',text:'参考用途：'+String(ref.role||'场景参考')},{type:'image_url',image_url:{url:imageDataUrl(mediaPath(ref.path))}});
 const result=await providers.chat({baseUrl:ch.baseUrl,apiKey:ch.apiKey,model:ch.model,protocol:ch.type==='gemini'?'gemini':ch.type==='openai-responses'?'responses':'chat',timeoutMs:180000,maxTokens:Math.min(ch.maxTokens||12000,16000),messages:[{role:'system',content:system},{role:'user',content}]});
 const model=scene.resolveCameras(scene.parse(result.content));if(body.previous){for(const old of body.previous.objects||[]){if(old.locked){const fresh=model.objects.find(o=>o.id===old.id);if(!fresh||Object.keys(old).some(key=>key!=='locked'&&JSON.stringify(fresh[key])!==JSON.stringify(old[key])))throw Error('模型修改了锁定对象 '+old.id+'，结果未应用');}}}
 ok(res,{model,report:scene.validate(model),prompts:scene.prompts(model),modelName:ch.model});return true;
 }
 if(url.pathname==='/api/creative/scene/generate'&&method==='POST'){
 const imagegen=require('./imagegen');const report=scene.validate(body.model);if(!report.ok)throw Error('请先解决场景几何冲突再生成');
 const prompt=scene.prompts(body.model).find(p=>p.id===body.view);if(!prompt)throw Error('机位不存在');
 const ch=body.channelId?channels.get('image',body.channelId):channels.active('image');if(!ch||ch.enabled===false)throw Error('请选择可用的生图模型');
 const refs=[{path:mediaPath(body.guidePath),name:'坐标模型结构引导.png'},...(body.references||[]).slice(0,7).map(r=>({path:mediaPath(r.path),name:r.name}))];
 const images=await imagegen.generate(ch,{prompt:'第一张参考是当前机位的结构引导图，保留其布局、机位、门窗位置与遮挡。其余参考仅按注明用途借鉴，不复制其布局。参考用途：'+JSON.stringify((body.references||[]).map(r=>r.role))+'。'+prompt.prompt,count:1,refs,size:body.size||'auto'});
 const saved=imagegen.saveImages(images,undefined,project);ok(res,{items:saved.items,view:body.view,sourceRevision:body.sourceRevision,sourceModel:body.model});return true;
 }
 if(url.pathname==='/api/creative/scene/describe'&&method==='POST'){
  if(!body.path)throw Error('请先选择一张场景图');
  const ch=llmChannel(body.channelId);
  const out=await providers.chat({baseUrl:ch.baseUrl,apiKey:ch.apiKey,model:ch.model,protocol:protocolOf(ch),timeoutMs:180000,maxTokens:2000,messages:[{role:'system',content:SCENE_DESCRIBE_SYSTEM},{role:'user',content:[{type:'text',text:'把这张图反推成场景描述。'},{type:'image_url',image_url:{url:imageDataUrl(mediaPath(body.path))}}]}]});
  const description=String(out.content||'').trim();if(!description)throw Error('模型没有返回场景描述');
  ok(res,{description,model:ch.model});return true;
 }
 if(url.pathname==='/api/creative/scene/view-prompts'&&method==='POST'){
  const description=String(body.description||'').trim();
  if(!description)throw Error('请先填写或反推场景描述');
  // 全部交给后端智能体按「场景4视图反推」技能推理，这里不再直连模型
  const result=await sceneViewPromptsByAgent({project,name:body.name,description,channelId:body.channelId,itemId:body.itemId});
  ok(res,result);return true;
 }
 // 连接被中断时取回这条画面上一次的推理结果（智能体那边早就跑完了，结果不会丢）
 if(url.pathname==='/api/creative/scene/view-prompts/last'&&method==='GET'){
  const itemId=url.searchParams.get('itemId')||'';
  const cached=sceneCacheRead(project,itemId);
  if(!cached)throw Error('这条画面还没有存下过推理结果');
  ok(res,cached);return true;
 }
 if(url.pathname==='/api/creative/scene/view-image'&&method==='POST'){
  const prompt=[String(body.prefix||'').trim(),String(body.prompt||'').trim()].filter(Boolean).join('\n\n');
  if(!prompt)throw Error('提示词为空');
  const ch=body.channelId?channels.get('image',body.channelId):channels.active('image');
  if(!ch||ch.enabled===false)throw Error('请选择可用的生图模型');
  // 四张图总被画成一个样，主要是两件事：机位说明埋在长提示词末尾、以及参考图只有那张源图。
  // 这里把机位提到最前面，并给每张参考图写清用途；其余场景内容照旧跟在后面。
  const view=String(body.view||'');
  const camera=SCENE_CAMERA_LINES[view]||'';
  const given=Array.isArray(body.references)?body.references.slice(0,3):[];
  const refs=[];
  const roles=[];
  for(const ref of given){
   const p=String((ref&&ref.path)||'').trim();
   if(!p)continue;
   refs.push({path:mediaPath(p),name:String(ref.name||'参考图')});
   roles.push(String(ref.role||'参考图'));
  }
  if(!refs.length&&body.sourcePath){
   refs.push({path:mediaPath(body.sourcePath),name:'场景源图'});
   roles.push('场景源图：只借材质、家具造型与配色，机位必须按本图机位重画，不许照抄这张图的构图与视角');
  }
  const composed=[
   camera,
   roles.length?('参考图用途：'+roles.join('；')+'。'):'',
   refs.length?'只借参考图的材质、家具造型与配色；机位与构图必须按上面的机位重新取景，不要复制任何参考图的视角。':'',
   prompt,
  ].filter(Boolean).join('\n\n');
  const imagegen=require('./imagegen');
  const images=await imagegen.generate(ch,{prompt:composed,count:1,refs,size:body.size||'auto'});
  const saved=imagegen.saveImages(images,undefined,project);
  ok(res,{items:saved.items,view,camera:!!camera});return true;
 }
 bad(res,'未知创作接口',404);return true;
 }catch(e){bad(res,e.message,e.status||400);return true;}
};

