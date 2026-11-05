import fs from 'node:fs/promises';
import {argsOf,readJSON,report,isMain,parseScript} from './common.mjs';
import {validateTiming,unitKey} from './check-timing.mjs';
export function validateEdits(original,execution,ledger,timing){
 const errors=[],warnings=[];const check=(ok,msg)=>{if(!ok)errors.push(msg);};
 const a=parseScript(original),b=parseScript(execution);
 check(a.groups>0&&a.groups===b.groups,'Group count differs or no groups.');
 check(a.masked===b.masked,'Non-dialogue content changed: only registered dialogue text may differ.');
 check(ledger.schemaVersion==='0.4.2','Unsupported edit schemaVersion.');
 check(ledger.authorization?.overloadOnly===true&&typeof ledger.authorization?.basis==='string'&&!!ledger.authorization.basis.trim(),'Explicit overload-only authorization basis required.');
 check(Array.isArray(ledger.edits),'edits array required.');
 const originals=new Map(a.utterances.map(u=>[u.key,u])),executions=new Map(b.utterances.map(u=>[u.key,u]));
 check(originals.size===a.utterances.length&&executions.size===b.utterances.length,'Duplicate source voice key.');
 check(a.utterances.length===b.utterances.length,'Source utterance count changed.');
 const actualChanged=new Set(a.utterances.filter(u=>executions.get(u.key)?.text!==u.text).map(u=>u.key));
 const timingCheck=validateTiming(timing);errors.push(...timingCheck.errors.map(e=>'Timing: '+e));warnings.push(...timingCheck.warnings);
 const timingMap=new Map((timing.utterances??[]).map(u=>[unitKey(u),u]));
 check(timingMap.size===b.utterances.length,'Timing must cover all execution utterances exactly once.');
 for(const u of b.utterances){const t=timingMap.get(u.key);check(!!t&&t.text===u.text&&t.speaker===u.speaker&&t.channel===u.channel&&t.shotDuration===u.shotDuration,u.key+' timing does not match execution voice.');}
 const registered=new Set();
 for(const e of ledger.edits??[]){
  const key=unitKey(e);check(!registered.has(key),key+' duplicate edit.');registered.add(key);
  const before=originals.get(key),after=executions.get(key),t=timingMap.get(key);
  check(!!before&&!!after,key+' missing source voice.');
  if(!before||!after||!t)continue;
  check(before.speaker===after.speaker&&before.channel===after.channel,key+' speaker/channel changed.');
  check(e.original===before.text&&e.revised===after.text,key+' edit text does not match files.');
  check(actualChanged.has(key),key+' registered edit has no text change.');
  check(typeof e.triggerReason==='string'&&!!e.triggerReason.trim()&&e.parallelismReviewed===true&&e.sceneRateReviewed===true,key+' overload/parallelism/rate review required.');
  const origParams={...t,...e.before,text:before.text,speaker:before.speaker,channel:before.channel};
  check(!!e.before?.spokenText,key+' original confirmed reading required.');
  for(const k of ['windowStart','windowEnd','start','rate'])check(origParams[k]===t[k],key+' original and revised must use same attempted timing '+k);
  const bc=validateTiming({schemaVersion:'0.4.2',utterances:[origParams]},{allowOverflow:true});
  errors.push(...bc.errors.map(x=>'Before '+key+': '+x));
  check(bc.rows.length===1&&!bc.rows[0].fits,key+' original is not overloaded under attempted parameters.');
  const review=e.semanticReview;
  check(review?.status==='reviewed'&&typeof review?.reviewer==='string'&&!!review.reviewer.trim(),key+' semantic review record required.');
  check(Array.isArray(review?.preservedFacts)&&review.preservedFacts.length>0&&review.preservedFacts.every(x=>typeof x==='string'&&!!x.trim()),key+' preservedFacts required.');
  check(Array.isArray(review?.omissions)&&review.omissions.every(x=>typeof x.text==='string'&&!!x.text.trim()&&typeof x.reason==='string'&&!!x.reason.trim()),key+' omissions require text and reason.');
  check(Array.isArray(e.protectedSpans),key+' explicit protectedSpans array required.');
  for(const s of e.protectedSpans??[])check(typeof s==='string'&&!!s&&before.text.includes(s)&&after.text.includes(s),key+' protected span missing: '+s);
  const nums=s=>s.match(/\d+(?:[./]\d+)*/g)||[];
  check(JSON.stringify(nums(before.text))===JSON.stringify(nums(after.text)),key+' Arabic numeric values changed.');
  check(e.speaker===before.speaker&&e.channel===before.channel,key+' edit speaker/channel differs.');
 }
 for(const key of actualChanged)check(registered.has(key),key+' unregistered changed dialogue.');
 for(const key of registered)check(actualChanged.has(key),key+' edit registration not an actual change.');
 return {passed:errors.length===0,errors,warnings,originalUtterances:a.utterances.length,changedUtterances:actualChanged.size,scope:'Structural edit mapping and declared overload/semantic-review records only; semantic equivalence still needs substantive review.'};
}
if(isMain(import.meta.url)){try{const a=argsOf();if(!a.original||!a.execution||!a.edits||!a.timing)throw Error('Usage: node check-edits.mjs --original original.txt --execution execution.txt --edits edits.json --timing timing.json [--report report.json]');await report(validateEdits(await fs.readFile(a.original,'utf8'),await fs.readFile(a.execution,'utf8'),await readJSON(a.edits),await readJSON(a.timing)),a.report);}catch(e){console.error(e.message);process.exitCode=1;}}
