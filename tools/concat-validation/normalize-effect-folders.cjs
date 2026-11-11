// Validation-only repair: preserve manifest IDs; align package folder names.
const fs=require('node:fs'),path=require('node:path');
const root=fs.realpathSync(path.resolve(__dirname,'../../Concat/src/crates/concat-effects/packages'));
const changes=[];const ids=new Set();
for(const folder of fs.readdirSync(root)){
 const file=path.join(root,folder,'effect.toml');if(!fs.existsSync(file))continue;
 const id=fs.readFileSync(file,'utf8').match(/^id\s*=\s*"([^"]+)"/m)?.[1];
 if(!id||!/^concat\.[a-z0-9-]+$/.test(id))throw Error('Invalid ID: '+file);
 if(ids.has(id))throw Error('Duplicate ID: '+id);ids.add(id);
 if(folder===id)continue;
 const from=path.resolve(root,folder),to=path.resolve(root,id);
 if(path.dirname(from)!==root||path.dirname(to)!==root)throw Error('Out of scope path');
 if(fs.existsSync(to))throw Error('Target already exists: '+to);
 changes.push({from,to});
}
const out=path.resolve(__dirname,'../../outputs/concat-validation/effect-folder-repair.json');
if(changes.length)fs.writeFileSync(out,JSON.stringify({reason:'Manifest ID and package folder must match; retain IDs and content',changes},null,2));
for(const c of changes)fs.renameSync(c.from,c.to);
console.log('Normalized '+changes.length+' package folders; no file contents changed.');
