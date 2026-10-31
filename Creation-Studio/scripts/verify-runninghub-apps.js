'use strict';
/**
 * 对照 RunningHub 公开应用详情，核对插件里的节点映射是否仍然正确。
 * 只读：不携带密钥、不上传素材、不提交生成任务。
 * 用法：node scripts/verify-runninghub-apps.js [--json]
 */
const path=require('node:path');
const config=require(path.join(__dirname,'../plugins/video/runninghub-h3/workflows.json'));

async function detail(site,applicationId){
 const res=await fetch(site.baseUrl+'/api/webapp/detail',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({webappId:applicationId})});
 const body=await res.json().catch(()=>null);
 return {status:res.status,body};
}

function compare(app,data){
 const nodes=data.inputNodes||[];
 const prompt=nodes.find(n=>String(n.nodeId)===String(app.prompt.nodeId));
 const duration=nodes.find(n=>String(n.nodeId)===String(app.duration.nodeId));
 const aspect=nodes.find(n=>String(n.nodeId)===String(app.aspect.nodeId));
 const images=nodes.filter(n=>n.fieldName===app.images.fieldName).map(n=>String(n.nodeId));
 const problems=[];
 if(!prompt)problems.push('提示词节点不存在：'+app.prompt.nodeId);
 else if(prompt.fieldName!==app.prompt.fieldName)problems.push('提示词字段名变了：'+prompt.fieldName);
 if(!duration)problems.push('时长节点不存在：'+app.duration.nodeId);
 else if(duration.fieldName!==app.duration.fieldName)problems.push('时长字段名变了：'+duration.fieldName);
 if(!aspect)problems.push('比例节点不存在：'+app.aspect.nodeId);
 else if(aspect.fieldName!==app.aspect.fieldName)problems.push('比例字段名变了：'+aspect.fieldName);
 if(JSON.stringify(images)!==JSON.stringify(app.images.nodes))problems.push('参考图节点或顺序变化：'+images.join(','));
 return {name:data.name,problems};
}

(async()=>{
 const rows=[];
 for(const [key,app] of Object.entries(config.apps)){
  const site=config.sites[app.site];
  try{
   const {status,body}=await detail(site,app.applicationId);
   if(!body||String(body.code)!=='0'){rows.push({key,site:app.site,applicationId:app.applicationId,ok:false,problems:['应用不可用：HTTP '+status+' code '+(body&&body.code)]});continue;}
   const {name,problems}=compare(app,body.data||{});
   rows.push({key,site:app.site,applicationId:app.applicationId,ok:problems.length===0,problems,name});
  }catch(err){
   rows.push({key,site:app.site,applicationId:app.applicationId,ok:false,problems:['请求失败：'+err.message]});
  }
 }
 if(process.argv.includes('--json')){console.log(JSON.stringify(rows,null,1));}
 else{
  for(const row of rows)console.log((row.ok?'OK   ':'DIFF ')+row.site+' '+row.applicationId+' '+(row.name||'')+'  '+row.key+(row.problems.length?'\n      '+row.problems.join('\n      '):''));
  const bad=rows.filter(r=>!r.ok).length;
  console.log('\n合计 '+rows.length+' 个应用，正常 '+(rows.length-bad)+'，异常 '+bad);
 }
 process.exitCode=rows.some(r=>!r.ok)?1:0;
})();
