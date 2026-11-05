'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'creation-creative-tests-'));process.env.WMD_DATA_DIR=path.join(tmp,'data');
const scene=require('../src/scene-model');const {createStore}=require('../src/creative-store');
test('场景示例、五条独立提示词及机位避障',()=>{const m=scene.example();assert.equal(scene.validate(m).ok,true);const p=scene.prompts(m);assert.equal(p.length,5);for(const entry of p)assert.ok(entry.prompt.includes('desk'));m.cameras[0].position=[2.5,2.9,.4];assert.ok(scene.validate(m).issues.some(i=>i.rule==='camera'));});
test('旋转占地碰撞与高度分离，不将承载物算作碰撞',()=>{const m=scene.example();m.objects=[{id:'a',position:[2,2,0],size:[2,.2,1],rotation:45},{id:'b',position:[2,2,0],size:[2,.2,1],rotation:135}];assert.ok(scene.validate(m).issues.some(i=>i.rule==='collision'));m.objects[1].position[2]=1.2;assert.ok(!scene.validate(m).issues.some(i=>i.rule==='collision'));m.objects[1].position[2]=0;m.objects[1].parentId='a';assert.ok(!scene.validate(m).issues.some(i=>i.rule==='collision'));});
test('无效数值、ID重复和门窗越界返回明确错误',()=>{const m=scene.example();m.objects[0].position[0]=NaN;assert.throws(()=>scene.validate(m));const n=scene.example();n.objects[1].id=n.objects[0].id;assert.throws(()=>scene.validate(n));const o=scene.example();o.openings[0].end=999;assert.ok(scene.validate(o).issues.some(i=>i.rule==='opening'));});
test('工程按项目隔离并拒绝旧版本覆盖',()=>{const s=createStore(path.join(tmp,'store'));const first=s.save('scene','p1',{name:'A'});assert.equal(first.revision,1);assert.equal(s.all('scene','p2').length,0);const second=s.save('scene','p1',{...first,name:'B'});assert.equal(second.revision,2);assert.throws(()=>s.save('scene','p1',first),/已更新/);assert.equal(s.get('scene','p1',first.id).name,'B');});
test('场景AI接口传入视觉参考、解析结构化响应并拒绝锁定对象变动',async()=>{
 const channels=require('../src/channels');const providers=require('../src/providers');const route=require('../src/creative-routes');const channel=channels.create('llm',{name:'测试视觉',type:'openai-chat',baseUrl:'http://127.0.0.1:1/v1',apiKey:'test-only',model:'test',active:true});
 const original=providers.chat;let seen;providers.chat=async input=>{seen=input;return {content:JSON.stringify(scene.example())};};
 const invoke=async body=>{let response;await route({method:'POST'},{},new URL('http://localhost/api/creative/scene/analyze'),{readBody:async()=>body,mediaPath:p=>p,imageDataUrl:()=> 'data:image/png;base64,AA==',ok:(_,data)=>response={data},bad:(_,error,status)=>response={error,status}});return response;};
 try{const response=await invoke({channelId:channel.id,name:'书房',description:'书房场景',references:[{path:'ref.png',role:'平面图'}]});assert.equal(response.data.model.objects.length,3);assert.ok(seen.messages[1].content.some(x=>x.type==='image_url'));const before=scene.example();before.objects[0].locked=true;before.objects[0].position[0]=1;const conflict=await invoke({channelId:channel.id,name:'书房',description:'修改场景',previous:before});assert.match(conflict.error,/锁定对象/);providers.chat=async()=>({content:'not json'});assert.ok((await invoke({channelId:channel.id,description:'场景'})).error);}finally{providers.chat=original;}
});
test('实际渠道的escape封装只移除明确边界，保留严格JSON校验',()=>{const m=scene.example();assert.equal(scene.parse('<escape>'+JSON.stringify(m)+'</escape>').objects.length,3);assert.equal(scene.parse('<escape>'+JSON.stringify(m)).objects.length,3);assert.throws(()=>scene.parse('说明文字'+JSON.stringify(m)));});

test('显式地面薄层允许家具覆盖，错误薄层与锁定机位不被静默调整',()=>{const m=scene.example();m.objects.push({id:'rug',name:'地毯',position:[2.5,3,0],size:[3,3,.01],rotation:0,collisionMode:'surface'});assert.ok(!scene.validate(m).issues.some(i=>i.rule==='collision'));m.objects[3].size[2]=1;assert.throws(()=>scene.validate(m),/薄层/);m.objects.pop();const camera=m.cameras.find(c=>c.id==='back');camera.position=[2.5,5.85,1.6];const furniture=JSON.stringify(m.objects);scene.resolveCameras(m);assert.ok(m.adjustments.length);assert.equal(JSON.stringify(m.objects),furniture);assert.equal(scene.validate(m).ok,true);camera.position=[2.5,5.85,1.6];camera.locked=true;scene.resolveCameras(m);assert.deepEqual(camera.position,[2.5,5.85,1.6]);});

test('场景四视图：反推描述、四条机位提示词与单张出图', async () => {
  const channels = require('../src/channels'); const providers = require('../src/providers');
  const imagegen = require('../src/imagegen'); const route = require('../src/creative-routes');
  const channel = channels.create('llm', { name: '四视图推理', type: 'openai-chat', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test-only', model: 'test', active: true });
  const imageChannel = channels.create('image', { name: '四视图出图', type: 'openai-images', baseUrl: 'http://127.0.0.1:1/v1', apiKey: 'test-only', model: 'test-image', active: true });
  const originalChat = providers.chat; const originalGen = imagegen.generate; const originalSave = imagegen.saveImages;
  const call = async (pathname, body) => { let response; await route({ method: 'POST' }, {}, new URL('http://localhost' + pathname), { readBody: async () => body, mediaPath: (p) => p, imageDataUrl: () => 'data:image/png;base64,AA==', ok: (_, data) => { response = { data }; }, bad: (_, error, status) => { response = { error, status }; } }); return response; };
  try {
    let seen;
    providers.chat = async (input) => { seen = input; return { content: '  一间朝西的书房，书架占满北墙。  ' }; };
    const described = await call('/api/creative/scene/describe', { channelId: channel.id, path: 'scene.png' });
    assert.match(described.data.description, /书架/);
    assert.ok(seen.messages[1].content.some((x) => x.type === 'image_url'));

    // 四条机位提示词已改由后端智能体按技能推理（覆盖在 tests/scene-agent.test.js），这里只验入参校验
    const noDescription = await call('/api/creative/scene/view-prompts', { channelId: channel.id, description: '   ' });
    assert.match(noDescription.error, /场景描述/);

    let seenPrompt;
    imagegen.generate = async (ch, input) => { seenPrompt = input; return [{ buffer: Buffer.from('fake'), mime: 'image/png' }]; };
    imagegen.saveImages = () => ({ items: [{ path: '/tmp/view.png', name: 'view.png', url: '/api/file?path=x' }] });
    const view = await call('/api/creative/scene/view-image', { channelId: imageChannel.id, view: 'front', prompt: '正视提示', prefix: '项目场景风格', sourcePath: 'scene.png' });
    assert.equal(view.data.items[0].path, '/tmp/view.png');
    assert.equal(view.data.view, 'front');
    assert.ok(seenPrompt.prompt.includes('项目场景风格') && seenPrompt.prompt.includes('正视提示'));
    assert.equal(seenPrompt.refs.length, 1);
    const emptyPrompt = await call('/api/creative/scene/view-image', { channelId: imageChannel.id, prompt: '  ' });
    assert.match(emptyPrompt.error, /提示词/);
  } finally {
    providers.chat = originalChat; imagegen.generate = originalGen; imagegen.saveImages = originalSave;
  }
});

test('场景建模左栏铺满整列：没有把面板压成 250px 小框的旧规则，描述框跟着长高', () => {
  const css = fs.readFileSync(path.join(__dirname, '../web/creative.css'), 'utf8');
  const web = fs.readFileSync(path.join(__dirname, '../web/creative.js'), 'utf8');
  assert.ok(!/\.ce-side\s*\{[^}]*max-height\s*:\s*250px/.test(css), '旧的 .ce-side{max-height:250px} 会压扁左栏，必须去掉');
  assert.ok(!/\.ce-scene\s*\{\s*grid-template-columns\s*:\s*1fr\s*\}/.test(css), '旧的单列覆盖会废掉 380px 左栏');
  assert.ok(/\.ce-side\.scn-side\s*\{[^}]*max-height\s*:\s*none/.test(css), '左栏要显式解除高度上限');
  assert.ok(/\.ce-side\.scn-side\s*\{[^}]*height\s*:\s*100%/.test(css), '左栏要铺满整列');
  assert.ok(/label\.scn-desc\s*\{[^}]*flex\s*:\s*1 1 auto/.test(css), '描述这一格要能撑开');
  assert.ok(/#scn-description\s*\{[^}]*flex\s*:\s*1 1 auto/.test(css), '描述框要跟着长高');
  assert.ok(web.includes('class="scn-desc"'), '场景描述要带 scn-desc 类');
  assert.ok(/@keyframes scn-spin\s*\{/.test(css), '正在推理的转圈动画要有完整的 keyframes');
});
