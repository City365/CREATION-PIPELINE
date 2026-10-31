'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');
function createStore(directory) {
  const dir = () => directory || path.join(config.load().dataDir || config.DATA, 'creative');
  const key = (kind,project) => { if(!['scene','image'].includes(kind)) throw Error('未知文档类型');return path.join(dir(),kind+'-'+crypto.createHash('sha256').update(String(project||'default')).digest('hex').slice(0,24)+'.json'); };
  function all(kind,project) {const file=key(kind,project);if(!fs.existsSync(file))return [];return JSON.parse(fs.readFileSync(file,'utf8'));}
  function save(kind,project,doc) {
    const rows=all(kind,project);const index=rows.findIndex(d=>d.id===doc.id);const previous=rows[index];
    if(previous && doc.revision!==previous.revision) {const e=Error('文档已更新，请重新打开后再保存');e.status=409;throw e;}
    const item={...doc,id:previous?.id||crypto.randomUUID(),revision:(previous?.revision||0)+1,updatedAt:Date.now(),schemaVersion:1};
    if(index<0)rows.unshift(item);else rows[index]=item;
    fs.mkdirSync(dir(),{recursive:true});const file=key(kind,project);const temp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(temp,JSON.stringify(rows));fs.renameSync(temp,file);return item;
  }
  function get(kind,project,id) {const item=all(kind,project).find(d=>d.id===id);if(!item) {const e=Error('文档不存在');e.status=404;throw e;}return item;}
  return {all,save,get};
}
module.exports={createStore,...createStore()};
