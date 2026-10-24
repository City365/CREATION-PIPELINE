'use strict';
function readAttachmentState(selector='[data-testid="attachment-image-card"]') {
  const cards=[...document.querySelectorAll(selector)];
  for(const card of cards) for(const key of Object.keys(card).filter(k=>k.startsWith('__reactFiber'))) {
    let fiber=card[key];
    for(let depth=0;fiber&&depth<8;depth++,fiber=fiber.return) {
      const states=fiber.memoizedProps?.attachmentStates;
      if(Array.isArray(states))return states.map(v=>({fileName:String(v.fileName||''),fileKey:String(v.fileKey||''),status:String(v.status||''),
        uploadPercent:Number(v.uploadPercent||0),width:Number(v.imageWidth||0),height:Number(v.imageHeight||0),size:Number(v.size||0),md5:String(v.md5||'')}));
    }
  }
  return [];
}
module.exports={readAttachmentState};
