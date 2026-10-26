'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
function verify(input){for(const field of ['images','refs','audios'])for(const asset of input[field]||[]){if(!asset?.assetFingerprint||!asset.path)continue;const hash=crypto.createHash('sha256').update(fs.readFileSync(asset.path)).digest('hex');if(hash!==asset.assetFingerprint)throw new Error('参考素材内容已变更，请更新任务快照后再提交：'+(asset.name||asset.path));}}
module.exports={verify};
