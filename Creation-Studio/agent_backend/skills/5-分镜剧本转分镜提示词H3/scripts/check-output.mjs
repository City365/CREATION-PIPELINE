import fs from 'node:fs/promises';
import {argsOf,readJSON,report,isMain} from './common.mjs';
export function validateOutput(input,output,assetLibrary=null){
input=input.replace(/\r\n/g,'\n');output=output.replace(/\r\n/g,'\n');
const errors=[],warnings=[];const check=(ok,message)=>{if(!ok)errors.push(message);};
const sourceHeaders=[...input.matchAll(/^([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫIVXLCDM\d]+)[、.]\s*\[画面\]\s*时长\s*([0-9.]+)\s*秒[^\n]*$/gm)];
const outputHeaders=[...output.matchAll(/^\[Shot\s+(\d+)\][^\n]*$/gm)];
const source=sourceHeaders.map((m,i)=>({number:i+1,sourceLabel:m[1],duration:Number(m[2]),body:input.slice(m.index,sourceHeaders[i+1]?.index??input.length)}));
const shots=outputHeaders.map((m,i)=>({number:Number(m[1]),header:m[0],body:output.slice(m.index,outputHeaders[i+1]?.index??output.indexOf('\noverall_soundscape:',m.index)+1)}));
check((input.match(/^本组总时长[：:]/gm)||[]).length===1,'Checker accepts exactly one current group.');
check(source.length>0,'No supported source frame headers found.');
check(shots.length===source.length,'Shot count mismatch: source='+source.length+', output='+shots.length+'.');
check(!/\[Shot\s+\d+\s*[.\-][^\]]*\]/i.test(output),'Sub-numbered Shot identifiers found.');
check(output.startsWith('_::~OUTPUT_START::~_'),'Start marker must be first characters.');
check(output.endsWith('_::~OUTPUT_END::~_'),'End marker must be last characters.');
check(!/DIAGNOSTIC_[A-Z_]+/.test(output),'Diagnostic annotation leaked into normal output.');
check(/16:9 horizontal widescreen framing\./.test(output),'Missing 16:9 constraint.');
check(/No subtitles\./.test(output)&&/No background music\./.test(output),'Missing subtitle/music prohibition.');
const sections=['subject_definitions','summary','retention_analysis','detailed_description','overall_soundscape','non_diegetic_music'];
let previous=-1;for(const section of sections){const m=new RegExp('^'+section+':','m').exec(output);check(!!m,'Missing section: '+section);if(m){check(m.index>previous,'Section order incorrect: '+section);previous=m.index;}}
const fields=['LOCATION','CAMERA POSITION & SHOOTING DIRECTION','SHOT TYPE / FRAMING / CAMERA MOVEMENT','TIME MARKER','Action & Performance','END FRAME / END BEAT','Dialogue','SOUND','DURATION'];
let elapsed=0;const frames=[];
for(let i=0;i<source.length;i++){
 const s=source[i],o=shots[i];if(!o)continue;check(o.number===i+1,'Incorrect source-to-Shot number at index '+(i+1));
 let fieldAt=-1;for(const field of fields){const fm=new RegExp('^'+field+':([^\n]*)','m').exec(o.body);check(!!fm,'Shot '+o.number+' missing field '+field);if(fm){check(fm.index>fieldAt,'Shot '+o.number+' field order incorrect: '+field);check(fm[1].trim().length>0,'Shot '+o.number+' empty field: '+field);fieldAt=fm.index;}}
 const dm=/^DURATION:\s*\[?([0-9.]+)\s*s\]?/m.exec(o.body),d=dm?Number(dm[1]):NaN;
 check(Number.isFinite(d)&&Math.abs(d-s.duration)<1e-9,'Shot '+o.number+' duration differs from source.');
 const tm=/ At (\d{2}):(\d{2})\.(\d{3})(?:\s|$|,)/.exec(o.header);
 const start=tm?Number(tm[1])*60+Number(tm[2])+Number(tm[3])/1000:NaN;
 check(Number.isFinite(start)&&Math.abs(start-elapsed)<=0.00051,'Shot '+o.number+' cumulative start time is incorrect.');
 const expected=[...s.body.matchAll(/^台词[：:]\s*([^（\n]+?)（([^）]+)）[：:]\s*(.*)$/gm)].map(m=>({speaker:m[1].trim(),channel:m[2],text:m[3].trim()}));
 const rawUtterances=[...o.body.matchAll(/<d>\s*(?:\[Chinese\])?([\s\S]*?)<\/d>/g)];
 const actual=rawUtterances.map(m=>m[1].trim());
 const deliveryPrefixes=rawUtterances.map(m=>o.body.slice(o.body.lastIndexOf('\n',m.index)+1,m.index));
 check(JSON.stringify(actual)===JSON.stringify(expected.map(x=>x.text)),'Shot '+o.number+' exact dialogue or occurrence count differs from source.');
 for(let u=0;u<Math.min(expected.length,actual.length);u++){
  const prefix=deliveryPrefixes[u];const os=/OS|心声|内心/i.test(expected[u].channel);
  const channelLabel=/\(([^;)]*)(?:;|\))/.exec(prefix)?.[1]??'';
  check(prefix.includes('says:'),'Shot '+o.number+' utterance '+(u+1)+' requires a speaker/channel prefix on the same line.');
  check(os?/\bOS\b|inner monologue|心声|内心/i.test(channelLabel):!/\bOS\b|inner monologue|心声|内心/i.test(channelLabel),'Shot '+o.number+' utterance '+(u+1)+' voice channel mismatch.');
  const speakerPrefix=prefix.split('(')[0];const sourceNames=expected[u].speaker.split(/[、，,]/).map(s=>s.trim()).filter(Boolean);for(const name of sourceNames){const entry=(assetLibrary?.角色信息??[]).find(x=>x.name===name||(x.aliases??[]).includes(name));const candidates=entry?[entry.name,...(entry.aliases??[])]:[name];check(candidates.some(n=>speakerPrefix.includes(n)),'Shot '+o.number+' utterance '+(u+1)+' speaker mismatch or unresolved alias: '+name);}
 }
 if(s.duration===0)warnings.push('Shot '+o.number+' is zero-duration; import compatibility requires separate validation.');
 frames.push({shot:o.number,duration:d,start,dialogueCount:actual.length,hanCounts:expected.map(x=>(x.text.match(/\p{Script=Han}/gu)||[]).length)});elapsed+=s.duration;
}
const declared=/^本组总时长[：:]\s*([0-9.]+)\s*(?:s|秒)/m.exec(input);check(!!declared&&Math.abs(Number(declared[1])-source.reduce((s,x)=>s+x.duration,0))<1e-9,'Source duration sum differs from declared group duration.');
const declaredOutput=/^DURATION[：:]\s*\[?总时长\s*([0-9.]+)s\]?/m.exec(output);check(!!declaredOutput&&!!declared&&Number(declaredOutput[1])===Number(declared[1]),'Output group duration differs from source.');
const defs=[...output.matchAll(/^<(Subject|Scene|Prop)\s+(\d+)> is /gm)].map(m=>m[1]+' '+m[2]);check(new Set(defs).size===defs.length,'Duplicate entity definitions.');
for(const m of output.matchAll(/<(Subject|Scene|Prop)\s+(\d+)>/g))check(defs.includes(m[1]+' '+m[2]),'Undefined entity token '+m[0]);
if(assetLibrary){const assets=assetLibrary;const names=new Set(['角色信息','场景信息','物品信息'].flatMap(k=>(assets[k]??[]).map(x=>x.name)));for(const m of output.matchAll(/@([^\s<.,，、。:：;；()（）/]+)/g))check(names.has(m[1]),'Unknown bound asset @'+m[1]);}
const result={passed:errors.length===0,errors:[...new Set(errors)],warnings,sourceCount:source.length,outputCount:shots.length,frames,scope:'Deterministic text checks only; no model execution, geometry, audio duration, visual continuity or generated-video acceptance.'};
return result;
}
if(isMain(import.meta.url)){try{const a=argsOf();if(!a.input||!a.output)throw Error('Usage: node check-output.mjs --input input.txt --output output.txt [--assets assets.json] [--report report.json]');await report(validateOutput(await fs.readFile(a.input,'utf8'),await fs.readFile(a.output,'utf8'),a.assets?await readJSON(a.assets):null),a.report);}catch(e){console.error(e.message);process.exitCode=1;}}
