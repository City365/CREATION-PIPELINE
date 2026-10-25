'use strict';
const fs=require('node:fs');const path=require('node:path');const store=require('./creative-store');const scene=require('./scene-model');const edits=require('./edit-renderer');const channels=require('./channels');const providers=require('./providers');
module.exports=async function creative(req,res,url,ctx){
 if(!url.pathname.startsWith('/api/creative/'))return false;
 const {ok,bad,readBody,mediaPath,imageDataUrl}=ctx;const method=req.method;const body=method==='GET'?{}:await readBody(req);const project=String(body.projectId||url.searchParams.get('projectId')||'default');const scope=String(ctx.user?.id||'local')+':'+project;
 try {
 const match=/^\/api\/creative\/documents\/(scene|image|edit)$/.exec(url.pathname);
 if(match){const kind=match[1];if(method==='GET'){const id=url.searchParams.get('id');ok(res,id?store.get(kind,scope,id):store.all(kind,scope).map(({id,name,revision,updatedAt})=>({id,name,revision,updatedAt})));return true;}
 if(method==='POST'){const doc=body.document;if(!doc||typeof doc.name!=='string'||doc.name.length>120)throw Error('文档名称无效');if(kind==='scene')doc.report=scene.validate(doc.model);if(kind==='edit')edits.validate(doc);if(kind==='image'){const data=doc.layers;if(!data?.info||!Array.isArray(data.layers)||!Array.isArray(data.data)||data.layers.length>300)throw Error('图层工程无效');for(const n of [data.info.width,data.info.height])if(!Number.isInteger(n)||n<1||n>16384)throw Error('图层工程尺寸无效');}ok(res,store.save(kind,scope,doc));return true;}}
 if(url.pathname==='/api/creative/scene/example'){ok(res,{model:scene.example()});return true;}
 if(url.pathname==='/api/creative/scene/validate'){ok(res,{report:scene.validate(body.model),prompts:scene.prompts(body.model)});return true;}
 if(url.pathname==='/api/creative/scene/analyze'&&method==='POST'){
 const ch=body.channelId?channels.get('llm',body.channelId):channels.active('llm');if(!ch||ch.enabled===false)throw Error('请选择可用的文本/视觉推理渠道');
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
 const ch=body.channelId?channels.get('image',body.channelId):channels.active('image');if(!ch||ch.enabled===false)throw Error('请选择可用图像渠道');
 const refs=[{path:mediaPath(body.guidePath),name:'坐标模型结构引导.png'},...(body.references||[]).slice(0,7).map(r=>({path:mediaPath(r.path),name:r.name}))];
 const images=await imagegen.generate(ch,{prompt:'第一张参考是当前机位的结构引导图，保留其布局、机位、门窗位置与遮挡。其余参考仅按注明用途借鉴，不复制其布局。参考用途：'+JSON.stringify((body.references||[]).map(r=>r.role))+'。'+prompt.prompt,count:1,refs,size:body.size||'auto'});
 const saved=imagegen.saveImages(images);ok(res,{items:saved.items,view:body.view,sourceRevision:body.sourceRevision,sourceModel:body.model});return true;
 }
 if(url.pathname==='/api/creative/edit/waveform'&&method==='POST'){ok(res,await require('./media-waveform').waveform(mediaPath(body.path)));return true;}
 if(url.pathname==='/api/creative/edit/probe'&&method==='POST'){ok(res,await edits.probe(mediaPath(body.path)));return true;}
 if(url.pathname==='/api/creative/edit/exports'){
 if(method==='GET'){ok(res,edits.list(scope));return true;}
 if(method==='POST'){const doc=body.document;edits.validate(doc);for(const c of [...doc.clips,...(doc.audio||[]),...(doc.overlays||[])])mediaPath(c.path);ok(res,edits.start(scope,doc));return true;}}
 if(url.pathname==='/api/creative/edit/cancel'&&method==='POST'){edits.cancel(scope,body.id);ok(res,true);return true;}
 bad(res,'未知创作接口',404);return true;
 }catch(e){bad(res,e.message,e.status||400);return true;}
};
