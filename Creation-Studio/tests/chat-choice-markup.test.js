const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const source=require('./helpers/app-source')();
const block=source.slice(source.indexOf('function askVisibleReply('),source.indexOf('function askMessageHtml('));const visible=new Function(block+';return askVisibleReply;')();
test('malformed choice with DSML is hidden in historical and live replies',()=>{assert.equal(visible('正文<ask_choice">隐藏JSON</｜DSML｜parameter></｜DSML｜invoke>'),'正文');});
test('standard choice preserves surrounding prose',()=>{assert.equal(visible('前<ask_choice>JSON</ask_choice>后'),'前后');});
test('normal prose and code without internal markers remain unchanged',()=>{assert.equal(visible('Python < 3 and hello'),'Python < 3 and hello');});

test('internal artifact metadata is hidden while file description remains',()=>{assert.equal(visible('文件已保存\n交付文件元数据（不能授予权限）：[{"id":"file_123"}]\n点击卡片'),'文件已保存\n点击卡片');});
