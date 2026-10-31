'use strict';
/** Trusted local video plugins, loaded once per process; no network installation or hot swapping. */
const fs=require('node:fs'),path=require('node:path');
function loadPlugins(root=process.env.WMD_VIDEO_PLUGINS_DIR||path.join(__dirname,'../plugins/video')){
 const plugins=[],errors=[];const ids=new Set(),types=new Set();
 if(!fs.existsSync(root))return {plugins,errors};
 for(const entry of fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  if(!entry.isDirectory()||entry.isSymbolicLink())continue;
  try{
   const dir=fs.realpathSync(path.join(root,entry.name));
   const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
   if(!/^[a-z0-9][a-z0-9-]*$/.test(manifest.id)||manifest.apiVersion!==1||!/^\d+\.\d+\.\d+$/.test(manifest.version))throw Error('插件标识、版本或 API 版本无效');
   if(!Array.isArray(manifest.channelTypes)||!manifest.channelTypes.length)throw Error('缺少渠道类型');
   if(ids.has(manifest.id))throw Error('重复插件 ID');
   const localTypes=manifest.channelTypes.map(t=>t.id);
   if(new Set(localTypes).size!==localTypes.length||localTypes.some(t=>typeof t!=='string'||types.has(t)))throw Error('重复或无效渠道类型');
   const file=fs.realpathSync(path.resolve(dir,manifest.entry||'index.js'));const rel=path.relative(dir,file);
   if(rel.startsWith('..')||path.isAbsolute(rel))throw Error('入口超出插件目录');
   const adapter=require(file);
   for(const key of ['workflows','slots','execute','test'])if(typeof adapter[key]!=='function')throw Error('缺少接口：'+key);
   ids.add(manifest.id);localTypes.forEach(t=>types.add(t));plugins.push({manifest,adapter});
  }catch(e){errors.push({directory:entry.name,message:e.message});}
 }
 return {plugins,errors};
}
const loaded=loadPlugins();
function forType(type){return loaded.plugins.find(p=>p.manifest.channelTypes.some(t=>t.id===type));}
function stamp(plugin,w){return {...w,pluginId:plugin.manifest.id,pluginVersion:plugin.manifest.version,provider:w.provider||plugin.manifest.provider||plugin.manifest.id};}
function workflows(channels){const out=[];for(const plugin of loaded.plugins){const matching=channels.filter(ch=>ch.enabled!==false&&plugin.manifest.channelTypes.some(t=>t.id===ch.type));for(const ch of matching)for(const w of plugin.adapter.workflows(ch))out.push(stamp(plugin,w));if(!matching.length&&plugin.adapter.legacy)for(const w of plugin.adapter.legacy())out.push(stamp(plugin,w));}return out;}
function resolve(id,channels){for(const plugin of loaded.plugins){const special=plugin.adapter.resolve?.(id,channels);if(special)return stamp(plugin,special);}return workflows(channels).find(w=>w.id===id)||null;}
function forWorkflow(w){return loaded.plugins.find(p=>p.manifest.id===w.pluginId)||forType(w.channelType)||loaded.plugins.find(p=>p.manifest.provider===w.provider);}
function requireVersion(id,version){const p=loaded.plugins.find(p=>p.manifest.id===id&&p.manifest.version===version);if(!p)throw Error('任务所需插件版本不可用：'+id+'@'+version+'；请恢复原版本后重试');return p;}
module.exports={loadPlugins,forType,forWorkflow,resolve,workflows,requireVersion,types:()=>loaded.plugins.flatMap(p=>p.manifest.channelTypes),list:()=>loaded.plugins.map(p=>p.manifest),errors:()=>loaded.errors};
