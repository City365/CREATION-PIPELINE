const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
const block=source.slice(source.indexOf('function askTraceRows('),source.indexOf('function askFilesHtml('));
const box={};new Function('module','const esc=String; const askMarkdown=String;'+block+';module.exports={askTraceHtml,askPlanDockHtml};')(box);
const {askTraceHtml,askPlanDockHtml}=box.exports;
const plan={goal:'生成剧本',steps:[{id:'s1',title:'确认范围',status:'completed'},{id:'s2',title:'写正文',status:'running'}]};
test('plan renders above composer and does not appear in execution trace',()=>{
 const msg={role:'assistant',planCollapsed:false,execution:{id:'r',status:'running',plan},liveTools:[{name:'read_file',status:'success'}]};
 const dock=askPlanDockHtml({messages:[msg]}),trace=askTraceHtml(msg,true);
 assert.match(dock,/确认范围/);assert.ok(dock.includes('1 / 2 已完成'));assert.doesNotMatch(trace,/确认范围|写正文|生成剧本/);
 const composer=source.slice(source.indexOf('function askComposerHtml(')); assert.ok(composer.indexOf('id="ask-plan-dock"')<composer.indexOf('id="ask-input"'));
});
test('plan reflects status changes and supports collapse',()=>{
 const msg={role:'assistant',planCollapsed:false,execution:{status:'running',plan:structuredClone(plan)}};
 msg.execution.plan.steps[1].status='completed';assert.ok(askPlanDockHtml({messages:[msg]}).includes('2 / 2 已完成'));
 msg.planCollapsed=true;assert.doesNotMatch(askPlanDockHtml({messages:[msg]}),/ask-plan-scroll/);
});
test('a new reply without a plan does not inherit the old plan',()=>{
 assert.equal(askPlanDockHtml({messages:[{role:'assistant',execution:{plan}},{role:'user'},{role:'assistant',execution:{id:'new'}}]}),'');
});
test('historical trace retains tool parameters and results separately from plan',()=>{
 const msg={execution:{id:'r',status:'completed'},traceOpen:true,trajectory:[{role:'assistant',tool_calls:[{id:'a',name:'create_task_plan',arguments:{goal:'SECRET_JSON'}}]},{role:'tool',tool_call_id:'a',tool_name:'create_task_plan',content:'RAW_JSON',status:'success'}]};
 const html=askTraceHtml(msg,false);assert.match(html,/create_task_plan/);assert.match(html,/SECRET_JSON/);assert.match(html,/RAW_JSON/);
});

test('plan is collapsed by default and matches composer width',()=>{const html=askPlanDockHtml({messages:[{role:'assistant',execution:{status:'completed',plan}}]});assert.doesNotMatch(html,/ask-plan-scroll/);assert.match(html,/aria-expanded="false"/);const css=fs.readFileSync(path.join(__dirname,'../web/styles.css'),'utf8');assert.match(css,/#ask-plan-dock\{max-width:860px/);});

test('unstarted plan is hidden and choice appears above fixed context labels',()=>{assert.equal(askPlanDockHtml({messages:[{role:'assistant',execution:{status:'completed',plan:{steps:[{title:'未执行',status:'pending'}]}}}]}),'');const composer=source.slice(source.indexOf('function askComposerHtml('));assert.ok(composer.indexOf('askChoicePanelHtml()')<composer.indexOf('ask-composer-context'));assert.ok(composer.indexOf('ask-composer-context')<composer.indexOf('id="ask-input"'));});
