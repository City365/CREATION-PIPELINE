'use strict';
const providers=require('./protocol');
const LIST=require('./workflows.json');
async function execute(ctx) {
  const {config,channels,job,workflow:wf,signal:a,slot,touch,log,checkCanceled,sleep,timeoutMs:JOB_TIMEOUT_MS,dataUrl,formatBytes,jobDir,saveOutputs,writeJobMeta,outputName,workbenchStore}=ctx;
  const channel=wf.channelId?channels.get('video',wf.channelId):null;
  const key = channel ? {token:channel.apiKey} : config.keyById(job.keyId) || config.load().autodlKeys.find((k) => k.enabled);
  if (!key?.token) throw new Error('请在 设置 → 视频生成 → AutoDL 官方H3 填写 API Key');
  job.apiUrl = channel?.baseUrl || providers.AUTODL_BASE;
  job.stage = '编码参考素材…';
  touch(job, { progress: 10 });
  const payload = { resolution: job.resolution || wf.defaultResolution };
  if (wf.promptRequired !== false) payload.prompt = job.prompt;
  if (wf.durationKey) payload[wf.durationKey] = job.duration;
  if (wf.seedKey) payload[wf.seedKey] = job.seed;
  const images = job.images.slice(0, wf.images);
  for (let i = 0; i < images.length; i++) {
    checkCanceled(job, a);
    payload[wf.imageKeys?.[i] || `ref_image_${i}`] = dataUrl(images[i].path, images[i].name);
    log(job, 'info', `图像 ${i + 1} → ref_image_${i}（base64）`);
  }
  const audios = job.audios.slice(0, wf.audios);
  for (let i = 0; i < audios.length; i++) {
    checkCanceled(job, a);
    payload[`ref_audio_${i}`] = dataUrl(audios[i].path, audios[i].name);
    log(job, 'info', `音频 ${i + 1} → ref_audio_${i}（base64）`);
  }
  for (const [i,video] of (job.videos || []).slice(0,wf.videos || 0).entries()) {
    checkCanceled(job,a);
    payload[wf.videoKeys?.[i] || `ref_video_${i}`] = dataUrl(video.path,video.name);
  }
  const masked = { ...payload };
  for (const [k, v] of Object.entries(masked)) {
    if (typeof v === 'string' && v.startsWith('data:')) masked[k] = v.slice(0, v.indexOf(',') + 1) + `<base64 ${formatBytes(v.length * 0.75)}>`;
  }
  job.inputValues = masked;

  job.stage = '提交到官网…';
  touch(job, { progress: 20 });
  const taskId = await providers.submitAutodl(key.token, wf.remoteWorkflowId || wf.id, payload, job.apiUrl);
  job.remotePromptId = taskId;
  log(job, 'info', '官网任务已提交：task_id=' + taskId);
  touch(job, { progress: 25, stage: '官网排队中…' });

  const started = Date.now();
  let result = null;
  while (Date.now() - started < JOB_TIMEOUT_MS) {
    checkCanceled(job, a);
    await sleep(4000);
    checkCanceled(job, a);
    result = await providers.pollAutodl(key.token, taskId, job.apiUrl);
    if (result.status === 'failed') throw new Error('官网任务失败：' + (result.message || result.rawStatus));
    if (result.status === 'success' && result.url) break;
    touch(job, {
      progress: Math.min(88, 25 + Math.round((Date.now() - started) / 1000 / 6)),
      stage: result.status === 'queued' ? '官网排队中…' : '生成中…',
    });
  }
  if (!result || !result.url) throw new Error('官网任务超时或未返回结果地址');

  job.stage = '下载结果…';
  touch(job, { progress: 90 });
  const dir = jobDir(job);
  job.outputDir = dir;
  const ext = (result.url.match(/\.(mp4|webm|mov|m4v)(?:\?|$)/i) || [])[1] || 'mp4';
  await saveOutputs(job, dir, [{ type: 'video', filename: 'video.' + ext, url: result.url }], a);
  writeJobMeta(job, dir, { apiUrl: job.apiUrl, worker: key.name, inputValues: masked });
  job.stage = '完成';
}


function workflows(channel){return LIST.filter(w=>!w.hidden).map(w=>({...w,id:'auto:'+channel.id+':'+w.id,remoteWorkflowId:w.id,channelId:channel.id,channelType:channel.type}));}
function resolve(id,all){if(!id.startsWith('auto:'))return LIST.find(w=>w.id===id)||null;for(const channel of all.filter(c=>c.enabled!==false&&c.type==='autodl-h3')){const hit=workflows(channel).find(w=>w.id===id);if(hit)return hit;}return null;}
module.exports={workflows,resolve,legacy:()=>LIST.filter(w=>!w.hidden),execute,test:ch=>providers.verifyAutodlKey(ch.apiKey,ch.baseUrl),slots:ch=>[{key:'ch:'+ch.id,provider:'autodl',id:ch.id,name:ch.name}],submit:providers.submitAutodl,poll:providers.pollAutodl};
