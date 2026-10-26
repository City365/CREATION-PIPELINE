'use strict';
const crypto=require('node:crypto');
const {store}=require('./workbench-store');
const channels=require('./channels');
const imagegen=require('./imagegen');
const styles=require('./styles');
const generationParams=require('../web/generation-params');
const fs=require('node:fs');
const path=require('node:path');
const config=require('./config');
function createImageTasks(options={}) {
  const data=options.store||store();let initialized=false,stopping=false,pumping=false;
  const active=new Map(),listeners=new Set();
  const resolveChannel=options.channel||(id=>id?channels.get('image',id):channels.active('image'));
  function db(){return data.open();}
  function initialize(){
    if(initialized)return;initialized=true;
    db().exec('CREATE TABLE IF NOT EXISTS image_tasks(id TEXT PRIMARY KEY REFERENCES generation_runs(id),request_json TEXT NOT NULL,result_json TEXT,phase TEXT NOT NULL,held INTEGER NOT NULL DEFAULT 0,request_key TEXT UNIQUE);CREATE TABLE IF NOT EXISTS generation_logs(seq INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL REFERENCES generation_runs(id),time INTEGER NOT NULL,level TEXT NOT NULL,message TEXT NOT NULL);CREATE INDEX IF NOT EXISTS generation_logs_run ON generation_logs(run_id,seq);');
    if(!db().prepare('PRAGMA table_info(image_tasks)').all().some(c=>c.name==='schedule_order'))db().exec('ALTER TABLE image_tasks ADD COLUMN schedule_order INTEGER NOT NULL DEFAULT 0');
    if(!db().prepare('PRAGMA table_info(image_tasks)').all().some(c=>c.name==='started_at'))db().exec('ALTER TABLE image_tasks ADD COLUMN started_at INTEGER');
    // A lost process cannot safely resubmit a provider request: preserve it for explicit retry.
    const orphan=db().prepare("SELECT r.* FROM generation_runs r LEFT JOIN image_tasks t ON r.id=t.id WHERE r.kind='image' AND (r.status='running' OR r.status='queued') AND (t.id IS NULL OR r.status='running')").all();
    for(const r of orphan){
      const s=JSON.parse(r.snapshot_json);
      db().prepare('INSERT OR IGNORE INTO image_tasks(id,request_json,phase) VALUES(?,?,?)').run(r.id,JSON.stringify({...s,prompt:s.userPrompt??s.prompt,finalPrompt:s.prompt,projectId:r.project_id,itemId:r.item_id}),'服务中断');
      db().prepare('UPDATE image_tasks SET phase=? WHERE id=?').run('服务中断，等待用户处理',r.id);
      data.finish(r.id,'interrupted',[],'服务重启中断了原请求；保留原提示词，未自动重新生成');
      db().prepare("UPDATE generation_runs SET finished_at=? WHERE id=?").run(Date.now(),r.id);
      log(r.id,'warn','服务重启后发现未完成请求，已保留记录；不能确认上游结果，不自动重发');
    }
  }
  function log(id,level,message){db().prepare('INSERT INTO generation_logs(run_id,time,level,message) VALUES(?,?,?,?)').run(id,Date.now(),level,String(message).slice(0,3000));}
  function get(id,includeLogs=true){initialize();const r=db().prepare('SELECT r.*,t.phase,t.held,t.result_json,t.started_at AS startedAt FROM generation_runs r JOIN image_tasks t ON t.id=r.id WHERE r.id=?').get(id);if(!r){const e=Error('图像任务不存在');e.status=404;throw e;}return {id:r.id,runId:r.id,itemId:r.item_id,projectId:r.project_id,kind:'image',status:r.status,phase:r.phase,held:!!r.held,createdAt:r.created_at,startedAt:r.startedAt,finishedAt:r.finished_at,error:r.error,snapshot:JSON.parse(r.snapshot_json),result:r.result_json?JSON.parse(r.result_json):null,logs:includeLogs?db().prepare('SELECT time,level,message FROM generation_logs WHERE run_id=? ORDER BY seq').all(id):[]};}
  function list(projectId){initialize();return db().prepare('SELECT r.id FROM generation_runs r JOIN image_tasks t ON t.id=r.id WHERE r.kind=\'image\''+(projectId?' AND r.project_id=?':'')+' ORDER BY r.created_at DESC LIMIT 200').all(...(projectId?[projectId]:[])).map(r=>get(r.id));}
  function page(projectId,index=1){initialize();const where="r.kind='image'"+(projectId?' AND r.project_id=?':'');const args=projectId?[projectId]:[];const total=db().prepare('SELECT COUNT(*) AS n FROM generation_runs r JOIN image_tasks t ON t.id=r.id WHERE '+where).get(...args).n;const page=Math.max(1,Math.min(Math.ceil(total/10)||1,index));const tasks=db().prepare('SELECT r.id FROM generation_runs r JOIN image_tasks t ON t.id=r.id WHERE '+where+' ORDER BY r.created_at DESC LIMIT 10 OFFSET ?').all(...args,(page-1)*10).map(row=>{const task=get(row.id,false);return {...task,snapshot:{userPrompt:(task.snapshot.userPrompt||task.snapshot.prompt||'').slice(0,100)}};});return {tasks,total,page,pageSize:10};}
  function emit(id){for(const fn of listeners){try{fn(get(id));}catch{}}}
  function phase(id,message){db().prepare('UPDATE image_tasks SET phase=? WHERE id=?').run(message,id);log(id,'info',message);emit(id);}
  function enqueue(input,finalOverride){
    initialize();
    if(input.requestId){const existing=db().prepare('SELECT id FROM image_tasks WHERE request_key=?').get(String(input.requestId));if(existing)return get(existing.id);}
    let channel=resolveChannel(input.channelId);if(channel)channel={...channel,model:input.model||channel.model};if(!channel)throw Error('没有启用的图像渠道，请先在设置里新增');
    if(!String(input.prompt||'').trim())throw Error('提示词不能为空');
    const prefix=finalOverride?input.prefixPrompt||'':input.applyStyle===false?'':typeof input.prefixPrompt==='string'?input.prefixPrompt.trim():input.styleId?styles.promptFor(input.styleId,{layer:input.styleLayer||'auto',text:input.prompt}):'';
    const prompt=finalOverride||generationParams.compose(input,prefix);
    const snapshot={...input,prefixPrompt:prefix,channelId:channel.id,channelName:channel.name,model:input.model||channel.model,prompt,userPrompt:String(input.prompt),kind:'image',status:input.paused?'paused':'queued'};
    const id=data.begin(snapshot);
    const request={...data.snapshot(input),prefixPrompt:prefix,prompt:String(input.prompt),channelId:channel.id,finalPrompt:prompt,projectId:input.projectId,itemId:input.itemId};
    db().prepare('INSERT INTO image_tasks(id,request_json,phase,held,request_key) VALUES(?,?,?,?,?)').run(id,JSON.stringify(request),input.paused?'已暂停，尚未发送':'排队中',input.paused?1:0,input.requestId?String(input.requestId):null);
    log(id,'info','已保存图像任务、完整提示词和参考素材快照');emit(id);setImmediate(pump);return get(id);
  }
  async function execute(id){
    const row=db().prepare('SELECT request_json FROM image_tasks WHERE id=?').get(id),input=JSON.parse(row.request_json);
    let channel;
    try{
      require('./task-assets').verify(input);
      db().prepare('UPDATE image_tasks SET started_at=? WHERE id=?').run(Date.now(),id);
      data.finish(id,'running');phase(id,'准备参考素材');
      channel=resolveChannel(input.channelId);if(channel)channel={...channel,model:input.model||channel.model};if(!channel)throw Error('原图像渠道已删除，请检查渠道后手动重试');
      log(id,'info','渠道：'+channel.name+'；模型：'+channel.model+'；参考图：'+(input.refs||[]).length+' 张');
      phase(id,'已向图像渠道提交，等待生成结果');
      const buffers=await (options.generate||imagegen.generate)(channel,{...input,prompt:input.finalPrompt});
      if(!buffers?.length)throw Error('图像渠道未返回图片');
      phase(id,'收到图片，正在保存文件');
      const saved=(options.saveImages||imagegen.saveImages)(buffers);
      data.finish(id,'success',saved.items);
      db().prepare('UPDATE image_tasks SET result_json=?,phase=?,held=0 WHERE id=?').run(JSON.stringify({...saved,runId:id}),'完成',id);
      // Merge only generated outputs. Never replace a prompt edited while the task was running.
      if(input.itemId){const item=data.get(input.itemId,input.projectId,'image',true);const draft={...item.draft,results:saved.items,previewIndex:0,zoom:'fit',_imageRunId:id};data.update(item.id,item.projectId,'image',{revision:item.revision,draft});}
      log(id,'success','已保存 '+saved.items.length+' 张图片；可从原画面、任务日志或媒体库恢复');
      if(options.remember)options.remember({...saved,prompt:input.prompt,channelId:channel.id,channelName:channel.name,createdAt:Date.now()});
      else remember({...saved,prompt:input.prompt,channelId:channel.id,channelName:channel.name,createdAt:Date.now()});
      emit(id);return get(id);
    }catch(e){
      const raw=String(e.message||e);const message=channel?.apiKey?raw.split(channel.apiKey).join('[已隐藏]'):raw;
      data.finish(id,'failed',[],message);db().prepare('UPDATE image_tasks SET phase=? WHERE id=?').run('失败',id);log(id,'error',message);emit(id);return get(id);
    }
  }
  function pump(){initialize();if(stopping||pumping||active.size)return;pumping=true;try{const row=db().prepare("SELECT r.id FROM generation_runs r JOIN image_tasks t ON t.id=r.id WHERE r.status='queued' AND t.held=0 ORDER BY t.schedule_order,r.created_at LIMIT 1").get();if(row){const promise=execute(row.id);active.set(row.id,promise);promise.finally(()=>{active.delete(row.id);setImmediate(pump);});}}finally{pumping=false;}}
  function pause(id){const task=get(id);if(!['queued','running','paused'].includes(task.status))throw Error('任务已结束');db().prepare('UPDATE image_tasks SET held=1 WHERE id=?').run(id);if(task.status!=='running')data.finish(id,'paused');phase(id,task.status==='running'?'已暂停后续；当前请求已提交，继续接收并保存结果':'已暂停，尚未发送');return get(id);}
  function resume(id){const task=get(id);if(!task.held&&task.status!=='paused')throw Error('任务未暂停');db().prepare('UPDATE image_tasks SET held=0 WHERE id=?').run(id);if(task.status==='paused')data.finish(id,'queued');phase(id,task.status==='running'?'继续等待已提交结果':'继续排队');setImmediate(pump);return get(id);}
  function setOrder(id,order){initialize();db().prepare('UPDATE image_tasks SET schedule_order=? WHERE id=?').run(order,id);}
  function cancelPending(id){const task=get(id);if(!['queued','paused'].includes(task.status))throw Error('已提交的图像任务不能取消生成');db().prepare('UPDATE image_tasks SET held=1,phase=? WHERE id=?').run('已取消，未发送',id);data.finish(id,'canceled',[]);log(id,'info','已取消尚未提交的请求');emit(id);return get(id);}
  function retry(id,options={}){const task=get(id);if(['queued','running','paused'].includes(task.status))throw Error('任务尚未结束，不能重复提交');const row=db().prepare('SELECT request_json FROM image_tasks WHERE id=?').get(id);log(id,'info','用户手动请求重新生成，新建独立任务');const input=JSON.parse(row.request_json);delete input.requestId;return enqueue({...input,paused:!!options.paused,applyStyle:false},input.finalPrompt);}
  async function wait(id){for(;;){const task=get(id);if(['success','failed','interrupted'].includes(task.status))return task;await new Promise(r=>setTimeout(r,100));}}
  function close(){stopping=true;return Promise.all([...active.values()]);}
  return {initialize,enqueue,get,list,page,pump,pause,resume,retry,setOrder,cancelPending,wait,close,activeCount:()=>active.size,on:fn=>{listeners.add(fn);return()=>listeners.delete(fn);}};
}
function remember(entry){try{const file=path.join(config.load().dataDir||config.DATA,'image-history.json');let rows=[];try{rows=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}fs.writeFileSync(file,JSON.stringify([entry,...rows].slice(0,80),null,2));}catch{}}
let singleton;function tasks(){return singleton||(singleton=createImageTasks());}
module.exports={createImageTasks,tasks};
