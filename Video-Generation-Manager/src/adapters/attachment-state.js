'use strict';
// Reads the Doubao composer attachment state from the live React tree.
//
// The composer now renders one card component per file whose own props carry the
// authoritative `status` / `progressPercent` / `attachmentState`. Wrapper copies
// of `attachmentStates` sit many levels above the card (12+ in the current build)
// and can keep an outdated Uploading snapshot, so reading the wrapper copy makes
// a finished upload look stuck forever. Resolve each card from its nearest props
// first, and only fall back to the list array (matched by DOM order).
// React keeps the current and the alternate fiber trees. Only the committed root
// is authoritative; walk its child/sibling graph (parent links can cross reused
// branches) and carry the nearest attachment props downward.
function readAttachmentState(selector='[data-testid="attachment-image-card"]') {
  const cards=[...document.querySelectorAll(selector)];
  const cardSet=new Set(cards);
  const num=v=>Number(v||0);
  const normalize=v=>({fileName:String(v.fileName||''),fileKey:String(v.fileKey||''),status:String(v.status||''),
    uploadPercent:num(v.uploadPercent),width:num(v.imageWidth??v.width),height:num(v.imageHeight??v.height),
    size:num(v.size),md5:String(v.md5||'')});
  const fromAttachment=v=>v&&typeof v==='object'?normalize(v):null;
  const blank={fileName:'',fileKey:'',status:'',uploadPercent:0,width:0,height:0,size:0,md5:''};

  const roots=new Set();
  for(const card of cards)for(const key of Object.keys(card).filter(k=>k.startsWith('__reactFiber')))for(const origin of [card[key],card[key]?.alternate]){
    if(!origin)continue;let r=origin;for(let n=0;r.return&&n<200;n++)r=r.return;
    const current=r.stateNode?.current;if(current&&'child' in current)roots.add(current);
  }

  const byCard=new Map();let fallbackList=null;
  for(const root of roots){
    const stack=[{fiber:root,state:null,list:null}];const seen=new Set();
    while(stack.length&&seen.size<120000){
      const item=stack.pop();const fiber=item.fiber;if(!fiber||seen.has(fiber))continue;seen.add(fiber);
      const props=fiber.memoizedProps;let state=item.state;let inherited=item.list;
      if(props&&typeof props==='object'){
        const attachment=fromAttachment(props.attachmentState);
        if(attachment)state=attachment;
        if(Array.isArray(props.attachmentStates)&&props.attachmentStates.length===cards.length){inherited=props.attachmentStates.map(fromAttachment);fallbackList=inherited;}
        // The card component itself reports the live status for this one file.
        if(typeof props.progressPercent!=='undefined'||typeof props.status==='string'){
          const base=state||blank;
          state={...base,fileName:base.fileName||String(props.ariaLabel||''),status:String(props.status||base.status||''),
            uploadPercent:typeof props.progressPercent!=='undefined'?num(props.progressPercent):base.uploadPercent};
        }
      }
      if(fiber.stateNode&&cardSet.has(fiber.stateNode))byCard.set(fiber.stateNode,{state:state||null,list:inherited||null,index:cards.indexOf(fiber.stateNode)});
      if(fiber.sibling)stack.push({fiber:fiber.sibling,state:item.state,list:item.list});
      if(fiber.child)stack.push({fiber:fiber.child,state,list:inherited});
    }
  }

  // 找不到已提交的 fiber 树时不作任何猜测：宁可让上传确认超时报错，
  // 也不拿父链上的旧快照当成“上传完成”。旧版的父链读取已移除。
  if(!roots.size)return [];
  const result=[];
  for(const [index,card] of cards.entries()){
    const own=byCard.get(card)||null;
    const base=own?.list?.[own.index]??fallbackList?.[index]??null;
    if(!own?.state&&!base)continue;
    if(!own?.state){result.push(base);continue;}
    const filled={...own.state};for(const [k,v] of Object.entries(blank))if((filled[k]===''||filled[k]===0)&&base&&base[k]!==''&&base[k]!==0)filled[k]=base[k];
    result.push(filled);
  }
  return result;
}
module.exports={readAttachmentState};
