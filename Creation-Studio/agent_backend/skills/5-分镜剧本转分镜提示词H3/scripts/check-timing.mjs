import {argsOf,readJSON,report,isMain} from './common.mjs';
export const unitKey=u=>u.group+':'+u.shot+':'+u.voiceIndex;
export function measure(u){
 const count=(u.spokenText?.match(/\p{Script=Han}/gu)||[]).length;
 const pause=(u.pauses??[]).reduce((s,p)=>s+p.seconds,0);
 const seconds=u.onset+count/u.rate+pause+u.tail;
 return {count,pause,seconds,start:u.start,end:u.start+seconds,available:u.windowEnd-u.start,fits:u.start+seconds<=u.windowEnd+1e-9};
}
export function validateTiming(ledger,{allowOverflow=false}={}){
 const errors=[],warnings=[],rows=[],keys=new Set();const check=(ok,msg)=>{if(!ok)errors.push(msg);};
 check(ledger.schemaVersion==='0.4.2','Unsupported timing schemaVersion.');
 check(Array.isArray(ledger.utterances),'utterances must be an array.');
 for(const u of ledger.utterances??[]){
  const key=unitKey(u),prefix=key+' ';check(!keys.has(key),prefix+'duplicate voice id.');keys.add(key);
  for(const k of ['group','shot','voiceIndex'])check(Number.isInteger(u[k])&&u[k]>0,prefix+'invalid '+k);
  for(const k of ['speaker','channel','text','spokenText'])check(typeof u[k]==='string'&&u[k].trim().length>0,prefix+'missing '+k);
  for(const k of ['shotDuration','windowStart','windowEnd','start','rate','onset','tail'])check(Number.isFinite(u[k]),prefix+'finite '+k+' required.');
  check(u.rate>=2&&u.rate<=6.5,prefix+'rate must be 2–6.5 Han/s.');
  check(u.onset>=0.1&&u.onset<=0.2,prefix+'onset must be 0.1–0.2s.');
  check(u.tail>=0.1&&u.tail<=0.3,prefix+'tail must be 0.1–0.3s.');
  if(u.rate>=5.5)check((u.urgentSpeech===true&&!!u.urgentReason?.trim())||(u.rate<=6&&u.shortInterruption===true&&!!u.interruptionReason?.trim()),prefix+'fast rate requires urgent speech or short-interruption reason.');
  if(u.rate>6)check(u.urgentSpeech===true&&!!u.urgentReason?.trim(),prefix+'over 6 Han/s requires urgent exception.');
  check(u.windowStart>=0&&u.windowEnd>=u.windowStart&&u.windowEnd<=u.shotDuration+1e-9,prefix+'invalid voice window.');
  check(u.start>=u.windowStart-1e-9&&u.start<=u.windowEnd+1e-9,prefix+'start outside voice window.');
  check(!/[\p{Letter}\p{Number}]/u.test((u.spokenText??'').replace(/\p{Script=Han}/gu,'')),prefix+'spokenText must expand numbers/Latin into confirmed Chinese reading.');
  check(Array.isArray(u.pauses),prefix+'explicit pauses array required.');
  const ids=new Set();for(const p of u.pauses??[]){check(typeof p.id==='string'&&p.id.length>0&&!ids.has(p.id),prefix+'pause ids must be nonempty and unique.');ids.add(p.id);check(Number.isFinite(p.seconds)&&p.seconds>=0,prefix+'invalid pause seconds.');check(typeof p.reason==='string'&&p.reason.trim().length>0,prefix+'pause reason required.');}
  const m=measure(u);check(m.count>0,prefix+'no pronounced Han characters.');
  check(Number.isFinite(m.seconds),prefix+'invalid budget arithmetic.');
  if(!allowOverflow)check(m.fits,prefix+'voice exceeds window: end '+m.end.toFixed(6)+' > '+u.windowEnd);
  if(m.fits&&u.windowEnd-m.end<0.2)warnings.push(prefix+'less than 0.2s estimated spare time; verify real voice.');
  rows.push({...u,key,...m,actualAudioMeasured:false});
 }
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){const a=rows[i],b=rows[j];if(a.group!==b.group||a.shot!==b.shot)continue;if(Math.min(a.end,b.end)-Math.max(a.start,b.start)>1e-9){if(a.speaker===b.speaker)errors.push(a.key+' overlaps same speaker '+b.key);else warnings.push(a.key+' overlaps another speaker '+b.key+'; verify intentional simultaneous delivery and intelligibility.');}}
 return {passed:errors.length===0,errors,warnings,rows,scope:'Estimated timing under supplied reading and pause parameters only; no audio, semantics or acting validation.'};
}
if(isMain(import.meta.url)){try{const a=argsOf();if(!a.ledger)throw Error('Usage: node check-timing.mjs --ledger timing.json [--report report.json]');await report(validateTiming(await readJSON(a.ledger)),a.report);}catch(e){console.error(e.message);process.exitCode=1;}}
