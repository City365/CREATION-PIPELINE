(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.GenerationParams=factory();})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const ratios=['16:9','9:16','4:3','3:4'];
 const wide='左侧占整张图宽度的 1/3，独立占满全高，放置同一人物胸部以上的正面特写。右侧占宽度的 2/3，横向等分为三个独立竖向小格，从左到右分别放置人物全身正视图、人物全身右侧视图、人物全身背视图。';
 const quad='整张图为两列两排的四宫格，左右两列各占宽度的 1/2；上排占总高度的 1/3，下排占总高度的 2/3。左上格为人物胸部以上的正面头像，右上格为同一人物胸部以上的侧脸；左下格为全身正视图，右下格为全身背视图。';
 const crop='服装展示裁切要求：下述全身视图改为颈部以下至双脚的服装展示图，画框不包含头部；这是正常摄影取景裁切，颈部边缘完整自然，无伤口、无血腥、无切断肢体效果。头像/胸像区域保持完整，不受裁切影响。';
 const consistency='所有区域表现同一个成年人物，发型、服装、配饰、体型及色彩保持一致；各视角独立完整且不交叠，不把不同区域融合成一个姿态。不要出现网格编号、说明文字、水印或多余人物。';
 const layouts=[
  {id:'free',name:'自由构图',ratios,description:'',cells:[]},
  {id:'wide-character',name:'胸像＋三视图（左 1/3，右 2/3）',ratios:['16:9','4:3'],description:wide+consistency,cells:['胸部以上特写','全身正视','全身右侧','全身背视'],shape:'wide'},
  {id:'wide-outfit',name:'胸像＋服装三视图（右侧不含头部）',ratios:['16:9','4:3'],description:wide+crop+consistency,cells:['胸部以上特写','正面服装','右侧服装','背面服装'],shape:'wide'},
  {id:'portrait-character',name:'四宫格（上 1/3 头像，下 2/3 全身）',ratios:['9:16','3:4'],description:quad+consistency,cells:['正面头像','侧脸','全身正视','全身背视'],shape:'portrait'},
  {id:'portrait-outfit',name:'四宫格（下排服装展示，不含头部）',ratios:['9:16','3:4'],description:quad+crop+consistency,cells:['正面头像','侧脸','正面服装','背面服装'],shape:'portrait'},
  {id:'custom',name:'自定义分区',ratios,description:'',cells:[]}
 ];
 function available(ratio){return layouts.filter(l=>l.ratios.includes(ratio));}
 function layout(id){return layouts.find(l=>l.id===id);}
 function instructions(input){
  const ratio=input.imageRatio;if(!ratio||ratio==='auto')return '';
  if(!ratios.includes(ratio))throw Error('不支持的图片比例');
  const selected=layout(input.imageLayoutId||'free');
  if(!selected||!selected.ratios.includes(ratio))throw Error('图片样式与画面比例不匹配，请重新选择');
  const text=typeof input.layoutPrompt==='string'?input.layoutPrompt:selected.description;
  return '【画面比例与分区布局】\n输出画布宽高比为 '+ratio+'。'+(text?'\n'+text:'');
 }
 function compose(input,prefix){return [String(prefix||'').trim(),instructions(input),String(input.prompt||'')].filter(Boolean).join('\n\n');}
 return {ratios,layouts,available,layout,instructions,compose};
});
