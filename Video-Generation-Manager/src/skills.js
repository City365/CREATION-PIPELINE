'use strict';
// 测试页可勾选、动态注入的技能。
// stage=classify：注入回复理解提示词；stage=chat：注入智能体对话提示词。
const SKILLS=[
  {
    id:'intent',
    name:'语义理解',
    stage:'classify',
    description:'读懂平台回复是请求确认、软拒绝、硬拒绝还是询问参数。',
    prompt:'判定必须基于语义，不只看关键词；区分“暂时不能生成”的软拒绝和违规、侵权的硬拒绝。',
  },
  {
    id:'chat',
    name:'正常对话',
    stage:'chat',
    description:'以 AI 视频创作专家的身份自然、简短地回复。',
    prompt:'你是 AI 视频创作专家。用简短、具体、口语化的中文回复；优先使用管理器里的豆包 / Gemini 视频模型，需要时给出提示词和参数方案；不要自称通用助手，不要推荐无关的外部工具，不要输出 JSON 或 Markdown 代码块。',
  },
];
function list(){return SKILLS.map(({id,name,stage,description})=>({id,name,stage,description}));}
function has(ids,id){return (Array.isArray(ids)?ids:[]).includes(id);}
function prompts(ids,stage){
  const set=new Set(Array.isArray(ids)?ids:[]);
  return SKILLS.filter(skill=>set.has(skill.id)&&(!stage||skill.stage===stage)).map(skill=>skill.prompt);
}
module.exports={SKILLS,list,has,prompts};
