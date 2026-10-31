'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {CONFIRM_TEXTS,PUSH_TEXTS,makePhrasePicker}=require('../src/automation');

test('confirmation phrase pool has the requested variants and no duplicates',()=>{
  assert.equal(new Set(CONFIRM_TEXTS).size,CONFIRM_TEXTS.length);
  for(const expected of ['确认，开始生成视频','确定，生成视频','可以生成视频吧','快点，给我生成视频'])assert.ok(CONFIRM_TEXTS.includes(expected),expected);
  assert.ok(CONFIRM_TEXTS.length>=6);
});
test('push phrase pool asks for generation and has no duplicates',()=>{
  assert.equal(new Set(PUSH_TEXTS).size,PUSH_TEXTS.length);
  assert.ok(PUSH_TEXTS.every(text=>/生成视频|生成/.test(text)));
  assert.ok(PUSH_TEXTS.length>=5);
});
test('picker uses the whole pool before repeating and avoids the previous phrase',()=>{
  const pick=makePhrasePicker(['a','b','c']);
  const seen=[];let previous='';
  for(let i=0;i<6;i++){
    const next=pick(previous);
    assert.notEqual(next,previous,'不应连续使用同一句');
    seen.push(next);previous=next;
  }
  assert.deepEqual([...new Set(seen.slice(0,3))].sort(),['a','b','c']);
  assert.deepEqual([...new Set(seen.slice(3,6))].sort(),['a','b','c']);
});
