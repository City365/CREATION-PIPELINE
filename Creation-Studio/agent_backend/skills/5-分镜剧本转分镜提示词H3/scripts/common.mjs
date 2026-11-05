import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
export const readJSON=async p=>JSON.parse(await fs.readFile(p,'utf8'));
export function argsOf(argv=process.argv.slice(2)){const out={};for(let i=0;i<argv.length;i++){if(!argv[i].startsWith('--')||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Expected --name value: '+argv[i]);out[argv[i].slice(2)]=argv[++i];}return out;}
export function isMain(url){return !!process.argv[1]&&url===pathToFileURL(process.argv[1]).href;}
export async function report(result,path){if(path)await fs.writeFile(path,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));process.exitCode=result.passed?0:1;}
export function parseScript(text){
 text=text.replace(/\r\n/g,'\n');
 const groups=[...text.matchAll(/^本组总时长[：:]\s*([0-9.]+)\s*(?:s|秒)/gm)];
 const allFrames=[...text.matchAll(/^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫIVXLCDM\d]+)[、.]\s*\[画面\]\s*时长\s*([0-9.]+)\s*秒[^\n]*$/gm)];
 const frames=allFrames.map(m=>{const group=groups.filter(g=>g.index<m.index).length;const groupStart=groups[group-1]?.index??-1;return {group,shot:allFrames.filter(f=>f.index>=groupStart&&f.index<=m.index).length,duration:Number(m[2]),index:m.index};});
 const counts=new Map(),utterances=[];
 for(const m of text.matchAll(/^台词[：:][ \t]*([^（\r\n]+?)（([^）\r\n]+)）[：:][ \t]*([^\r\n]*)$/gm)){
  const f=frames.filter(f=>f.index<m.index).at(-1);if(!f)throw Error('Dialogue outside supported source frame.');
  const g=groups.filter(g=>g.index<m.index).length;if(g!==f.group)throw Error('Dialogue before a frame in group '+g);
  const frameKey=g+':'+f.shot,voiceIndex=(counts.get(frameKey)??0)+1;counts.set(frameKey,voiceIndex);
  utterances.push({key:frameKey+':'+voiceIndex,group:g,shot:f.shot,voiceIndex,speaker:m[1].trim(),channel:m[2].trim(),text:m[3],start:m.index+m[0].length-m[3].length,end:m.index+m[0].length,shotDuration:f.duration});
 }
 let masked='',at=0;for(const u of utterances){masked+=text.slice(at,u.start)+'{{VOICE:'+u.key+'}}';at=u.end;}masked+=text.slice(at);
 return {groups:groups.length,frames,utterances,masked};
}
