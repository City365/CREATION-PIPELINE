'use strict';
function uploadTrace(page){const events=[];const append=value=>{events.push({...value,at:new Date().toISOString()});if(events.length>40)events.shift();};
 const details=url=>{try{const u=new URL(url);return {host:u.hostname,path:u.pathname,action:u.searchParams.get('Action')||undefined};}catch{return {host:'unknown'};}};
 const relevant=request=>{try{return /upload|imagex|tos-|\.tos\.|volc.*api/i.test(request.url())||['xhr','fetch'].includes(request.resourceType());}catch{return false;}};
 const failed=request=>{if(relevant(request))append({type:'requestfailed',...details(request.url()),error:request.failure()?.errorText||'unknown'});};
 const response=res=>{try{const request=res.request(),url=res.url(),status=res.status();if(relevant(request)&&(status>=400||/upload|imagex|tos-|\.tos\./i.test(url))){const event={type:'response',...details(url),status};append(event);if(/ApplyImageUpload|CommitImageUpload/.test(event.action||''))res.json().then(body=>{const record=events.findLast(e=>e.at&&e.host===event.host&&e.action===event.action);if(!record)return;const error=body.ResponseMetadata?.Error||body.error||body.Error;record.businessCode=error?.Code??error?.code??body.code??body.BaseResp?.StatusCode??0;if(error)record.businessError=String(error.Message||error.message||'接口返回业务错误').replace(/https?:\/\/[^\s]+/g,'[url]').slice(0,200);record.resultCount=Array.isArray(body.Result?.Results)?body.Result.Results.length:undefined;}).catch(()=>{});}}catch{}};
 if(typeof page.on==='function'){page.on('requestfailed',failed);page.on('response',response);}
 return {events,stop(){page.off?.('requestfailed',failed);page.off?.('response',response);}};
}
module.exports={uploadTrace};
