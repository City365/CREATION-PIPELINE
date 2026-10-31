'use strict';
// 执行前暖场：正式提交提示词之前，先以普通创作者的身份和平台聊两轮
// 漫剧 / 短剧 / 小说 / 视频创作的话题，让会话上下文像正常的创作交流。
// 暖场只发普通聊天消息，不进入视频模式、不点确认、不消耗视频额度。
const {requestModel}=require('./reply-intent');

const OPENERS=[
  '最近在追一部漫剧，节奏比真人短剧还快，你觉得漫剧最抓人的地方是什么？',
  '现在短剧开头三秒抓不住人就被划走，你觉得哪种开场最稳？',
  '我在把一本小说改成一分钟短剧，人物动机总是不够顺，一般怎么处理？',
  '做视频久了发现分镜比文案更吃功夫，你平时先写分镜还是先定画面？',
  '同一个故事写成小说和拍成短剧，节奏上最大的区别在哪？',
  '漫剧的配音和画面节奏要怎么配合，才不显得赶？',
  '一条竖屏短片，前五秒怎么安排才留得住人？',
  '小说里的心理描写搬到视频里，一般用什么镜头替代？',
  '现在很多短剧一集只有一分钟，你觉得结尾留钩子更重要还是人物立住更重要？',
  '做漫剧的时候，你会先定画风还是先定人物小传？',
];
const FOLLOWUPS=[
  '那如果只有一分钟时长，你会先砍掉哪部分？',
  '这个思路放到古装题材里也适用吗？',
  '如果是竖屏手机观看，画面构图上要注意什么？',
  '有没有你觉得特别值得拆解学习的作品？',
  '那对新手来说，最容易踩的坑是什么？',
  '同样的桥段，怎么避免看起来像流水线？',
  '你会怎么判断一个开头值不值得继续做下去？',
  '这类内容在平台上的推荐逻辑，看得出来吗？',
];
const CONNECTORS=['有道理，','嗯，','确实，','明白了，','说到这个，'];
// 豆包默认会写长篇大论，暖场只是铺垫上下文，每条都请它简短回答，省时间。
const SHORT_ASKS=[
  '简单说两句就行，五十字以内。',
  '一两句话说个大概就好。',
  '不用展开，简短说说。',
  '挑重点说一两句，别太长。',
  '简短点，直接说结论。',
];

function makeStock(pool){
  let bag=[];
  return (avoid='')=>{
    if(!bag.length){
      bag=[...pool];
      for(let i=bag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[bag[i],bag[j]]=[bag[j],bag[i]];}
    }
    const index=Math.max(0,bag.findIndex(text=>text!==avoid));
    return bag.splice(index,1)[0];
  };
}
const nextOpener=makeStock(OPENERS);
const nextFollowup=makeStock(FOLLOWUPS);
const nextConnector=makeStock(CONNECTORS);
const nextShortAsk=makeStock(SHORT_ASKS);

// 每条暖场消息都带一句“简短回答”的要求；已经带了的就不重复加。
function withShortAsk(text){
  const value=String(text||'').trim();
  if(!value||/简短|简单说|一两句|几句|别太长|字数|五十字|100字/.test(value))return value;
  return value.replace(/[。！？!?]+$/,'')+'，'+nextShortAsk();
}

function validMessage(text){
  const value=String(text||'').replace(/\s+/g,' ').trim();
  if(value.length<8||value.length>80)return '';
  if(/https?:\/\/|www\.|@\S|#\S|[\u{1F300}-\u{1FAFF}]/u.test(value))return '';
  if(/生成视频|生成一段视频|提示词|帮我生成|帮我做视频/.test(value))return '';
  return value;
}

function parsePlan(text,rounds=2){
  const raw=String(text||'').replace(/```(?:json)?/gi,'');
  const start=raw.indexOf('{'),end=raw.lastIndexOf('}');
  if(start<0||end<=start)return null;
  let data;
  try{data=JSON.parse(raw.slice(start,end+1));}catch{return null;}
  if(!data||!Array.isArray(data.messages))return null;
  const messages=data.messages.map(validMessage).filter(Boolean).slice(0,rounds);
  return messages.length===rounds?messages:null;
}

// 模型不可用时的兜底：第一轮开一个创作话题，之后每条接一个自然追问。
function fallbackPlan(rounds=2){
  const messages=[nextOpener()];
  while(messages.length<rounds){
    messages.push(nextConnector()+nextFollowup(messages[messages.length-1]));
  }
  return messages;
}

function buildPlanPrompt({task={},rounds=2}){
  const lines=[
    '你在替一个普通创作者操作豆包网页。稍后他会提出具体的视频需求，现在先聊几轮创作话题。',
    '请写 '+rounds+' 条可以在豆包里自然发出的中文消息，围绕漫剧、短剧、小说、视频创作。',
    '只输出一个 JSON 对象，不要 Markdown、不要解释：{"messages":["第一条","第二条"]}',
    '要求：',
    '- 每条 15~45 个中文字符，口语化，像真人随手发的消息，可以带问号；',
    '- 第一条是泛泛的创作话题；之后每条顺着上文自然追问，可以隐约靠近下面的主题，但不要直接复述主题；',
    '- 每条结尾都要自然地请对方简短回答（一两句话、五六十个字以内），例如“简单说两句就行”；',
    '- 不要出现“生成视频”“提示词”“帮我做视频”“帮我生成”这类指令性表述；',
    '- 不要链接、@、表情、引号、编号或 Markdown。',
  ];
  const theme=String(task.prompt||'').replace(/\s+/g,' ').trim().slice(0,300);
  const user=(theme?'参考主题（不要直接引用）：'+theme+'\n':'')+'只输出 JSON。';
  return {system:lines.join('\n'),user};
}

async function planWarmup({settings,getDispatcher,task={},rounds=2}={}){
  const count=Math.max(1,Math.min(3,Number(rounds)||2));
  try{
    const cfg=settings&&settings.value&&settings.value.interpreter;
    if(cfg&&cfg.enabled&&cfg.baseUrl&&cfg.model){
      const {system,user}=buildPlanPrompt({task,rounds:count});
      const response=await requestModel(settings,getDispatcher,{system,user,maxTokens:600});
      if(!response.error){
        const messages=parsePlan(response.text,count);
        if(messages)return {messages:messages.map(withShortAsk),source:'ai'};
      }
    }
  }catch{/* 暖场计划拿不到就用兜底话术，不影响任务 */}
  return {messages:fallbackPlan(count).map(withShortAsk),source:'pool'};
}

function createWarmup({settings,getDispatcher}){
  return {
    config(){const cfg=(settings&&settings.value&&settings.value.warmup)||{};return {...cfg};},
    plan(input={}){return planWarmup({settings,getDispatcher,...input});},
  };
}

module.exports={createWarmup,planWarmup,fallbackPlan,parsePlan,buildPlanPrompt,validMessage,withShortAsk,OPENERS,FOLLOWUPS};
