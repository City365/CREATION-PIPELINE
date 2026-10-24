const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {convert,defaults,validate,createMappings}=require('../src/prompt-mappings');
test('speaker and Subject merge into one picture reference with connected dialogue',()=>{
 assert.equal(convert('[Shot 1] <Subject 1> (S1) <d>[Chinese]快迟到了！</d>','doubao').text,'Shot 1： <Picture 1>说：（中文）快迟到了！');
 assert.equal(convert('(S2) <d>[English]Hello.</d>','gemini').text,'图2中的人物说：（英文）Hello.');
});
for(const [lang,name] of Object.entries(defaults.languages))test('dialogue language '+lang,()=>assert.equal(convert('<d>['+lang+']台词</d>','doubao').text,'（'+name+'）台词'));
test('voiceover drops speaker identity and preserves gender and words',()=>{
 assert.equal(convert('(S1) <d>[Chinese]（男声画外音）故乡。</d>','doubao').text,'（中文，男声画外音）故乡。');
 assert.equal(convert('<d>[Japanese]（女声画外音）你好。</d>','gemini').text,'（日文，女声画外音）你好。');
});
test('Gemini converts Subject but preserves existing picture styles',()=>assert.equal(convert('<Subject 3> @图1 <Picture 2>','gemini').text,'图3 @图1 <Picture 2>'));
test('disabled shot keeps original tag and custom templates take effect',()=>{
 const cfg=structuredClone(defaults);cfg.rules.find(r=>r.id==='shot').enabled=false;cfg.rules.find(r=>r.id==='speaker').gemini='图{n}发言：';
 assert.equal(convert('[Shot 2] (S1)','gemini',cfg).text,'[Shot 2] 图1发言：');
});
test('unknown languages warn without losing speech',()=>{const r=convert('<d>[French]Bonjour</d>','gemini');assert.match(r.text,/Bonjour/);assert.equal(r.warnings.length,1);});
test('settings persist and invalid text-dropping templates are rejected',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'prompt-mapping-'));try{const a=createMappings(dir);const cfg=a.get();cfg.languages.French='法语';a.save(cfg);assert.equal(createMappings(dir).get().languages.French,'法语');cfg.rules[1].doubao='删除台词';assert.throws(()=>validate(cfg),/text/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
