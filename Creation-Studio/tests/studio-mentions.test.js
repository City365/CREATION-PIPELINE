const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../web/app.js'),'utf8');
function setup(){
 const studio={images:[null,{name:'actor.png',subject:'林辰'}],audios:[{name:'voice.wav'}]};
 const events={};const editor={value:'镜头中@林',selectionStart:6,selectionEnd:6,addEventListener(n,f){events[n]=f;},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;},setAttribute(){},removeAttribute(){}};
 editor.selectionStart=editor.selectionEnd=editor.value.length;
 const host={hidden:true,innerHTML:'',querySelectorAll(){return [];}};
 const context={state:{studio},currentWorkflow:()=>({images:4,audios:2}),esc:x=>x,validatePromptSoon(){},insertAtCursor(text){editor.value=editor.value.slice(0,editor.selectionStart)+text+editor.value.slice(editor.selectionEnd);studio.prompt=editor.value;}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function studioReferenceTags('),source.indexOf('function openTagMenu(')),context);
 context.bindStudioMentions(editor,host);return {context,studio,editor,host,events};
}
test('only uploaded references appear with submission-order numbering',()=>{
 const {context,studio}=setup();const tags=context.studioReferenceTags();
 assert.deepEqual(Array.from(tags,t=>t.insert),['<Picture 1>','<Subject 1>','<Audio 1>']);
 studio.images=[];studio.audios=[];assert.equal(context.studioReferenceTags().length,0);
});
test('Chinese text @ search selects uploaded picture and replaces query',()=>{
 const {editor,host,events,studio}=setup();events.input();assert.equal(host.hidden,false);assert.match(host.innerHTML,/林辰/);
 events.keydown({key:'Enter',preventDefault(){}});
 assert.equal(editor.value,'镜头中<Picture 1> ');assert.equal(studio.prompt,editor.value);assert.equal(host.hidden,true);
});
test('arrow selection distinguishes a subject from its picture',()=>{
 const {editor,events}=setup();events.input();events.keydown({key:'ArrowDown',preventDefault(){}});events.keydown({key:'Tab',preventDefault(){}});
 assert.equal(editor.value,'镜头中<Subject 1> ');
});
