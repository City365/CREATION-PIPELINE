'use strict';
const fs=require('node:fs'),path=require('node:path');
const managerVideo=require('./protocol');
function workflows(channel) {
 const channels={list:()=>[channel]};
  const out = [];
  for (const ch of channels.list('video')) {
    if (!ch.enabled || ch.type !== 'manager-video') continue;
    const opts = ch.options || {};
    const seconds = Math.min(15, Math.max(5, Number(opts.seconds) || 10));
    out.push({
      id: 'mgr:' + ch.id + ':doubao',
      channelId: ch.id,
      channelType: ch.type,
      provider: 'manager',
      platform: 'doubao',
      label: ch.name + ' · 豆包',
      note: '管理器浏览器生成 · 豆包 Seedance（Mini / Fast）· 5–15 秒',
      // 豆包网页有模型下拉，文案必须一字不差；创作台据此给「模型名称」下拉，
      // 选中后随任务发给管理器（Gemini 页面没有这一项，留空）。
      models: managerVideo.MODEL_CHOICES,
      images: 9,
      optionalImages: true,
      audios: 0,
      videos: 0,
      durationKey: 'duration',
      durationDefault: seconds,
      durationOptions: Array.from({ length: 11 }, (_, i) => i + 5),
      seedKey: '',
      sizeMode: 'ratio',
      ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      defaultRatio: '16:9',
      megapixelsOptions: [],
      megapixelsDefault: 0,
      megapixelsLabel: '画幅',
    });
    out.push({
      id: 'mgr:' + ch.id + ':gemini',
      channelId: ch.id,
      channelType: ch.type,
      provider: 'manager',
      platform: 'gemini',
      label: ch.name + ' · Gemini',
      note: '管理器浏览器生成 · Gemini 视频 · 固定 10 秒',
      images: 9,
      optionalImages: true,
      audios: 0,
      videos: 0,
      durationKey: 'duration',
      durationDefault: 10,
      durationOptions: [10],
      seedKey: '',
      sizeMode: 'ratio',
      ratios: ['16:9', '9:16'],
      defaultRatio: '16:9',
      megapixelsOptions: [],
      megapixelsDefault: 0,
      megapixelsLabel: '画幅',
    });
  }
  return out;
}

async function saveRemoteVideo(job, channel, taskId, platform, accountName, ctx) {
  const {jobDir,outputName,log,formatBytes,writeJobMeta}=ctx;
  const dir = jobDir(job);
  job.outputDir = dir;
  const { buffer, contentType } = await managerVideo.download(channel, taskId);
  const ext = /webm/i.test(contentType) ? '.webm' : '.mp4';
  const name = outputName(job, 'video', ext);
  const file = path.join(dir, name);
  fs.writeFileSync(file, buffer);
  job.outputs.push({ type: 'video', name, path: file, bytes: buffer.length, url: managerVideo.baseUrl(channel) + '/api/tasks/' + taskId + '/file' });
  log(job, 'info', `已下载 ${name}（${formatBytes(buffer.length)}）`);
  writeJobMeta(job, dir, {
    apiUrl: managerVideo.baseUrl(channel),
    worker: channel.name + ' · ' + (managerVideo.PLATFORM_LABEL[platform] || platform),
    inputValues: {
      channelId: channel.id,
      channel: channel.name,
      platform,
      model: managerVideo.modelOf(channel, job, platform) || '',
      duration: job.duration,
      ratio: managerVideo.shortAspect(job.aspectRatio || job.ratio),
      managerTaskId: taskId,
      managerAccount: accountName || '',
    },
  });
  return { name, file };
}

async function execute(ctx) {
  const {config,channels,job,workflow:wf,signal:a,slot,touch,log,checkCanceled,sleep,timeoutMs:JOB_TIMEOUT_MS,dataUrl,formatBytes,jobDir,saveOutputs,writeJobMeta,outputName,workbenchStore}=ctx;
  const channel = channels.get('video', slot.id);
  if (!channel) throw new Error('管理器渠道已删除，请重新选择');
  const platform = wf.platform || (slot && slot.platform) || 'doubao';
  job.apiUrl = managerVideo.baseUrl(channel);
  job.stage = '提交到管理器…';
  touch(job, { progress: 10 });
  log(job, 'info', `管理器渠道「${channel.name}」· ${managerVideo.PLATFORM_LABEL[platform] || platform}`
    + (managerVideo.modelOf(channel, job, platform) ? ` · 模型 ${managerVideo.modelOf(channel, job, platform)}` : '')
    + ` · 画幅 ${managerVideo.shortAspect(job.aspectRatio || job.ratio)}`);
  const submitted = job.resumeRemote && job.remotePromptId
    ? { taskId: job.remotePromptId, account: { name: '原任务账号' } }
    : await managerVideo.submit(channel, job, platform);
  job.remotePromptId = submitted.taskId;
  log(job, 'info', `已交给管理器账号「${submitted.account.name}」，任务 ${submitted.taskId}`);
  touch(job, { progress: 18, stage: '生成中…' });

  const started = Date.now();
  let result = null;
  while (Date.now() - started < JOB_TIMEOUT_MS) {
    checkCanceled(job, a);
    await sleep(5000);
    checkCanceled(job, a);
    result = await managerVideo.poll(channel, submitted.taskId);
    if(job.runId)workbenchStore.store().execution(job.runId,result);
    if (result.status === 'failed') {
      job.failureAnalysis = result.failureAnalysis || null;
      const reason = result.failureReason || result.message || result.rawStatus;
      const advice = result.failureAdvice ? '（建议：' + result.failureAdvice + '）' : '';
      throw new Error('管理器任务失败：' + reason + advice);
    }
    if (result.status === 'success') break;
    const byTime = 18 + Math.round((Date.now() - started) / 1000 / 4);
    touch(job, {
      progress: Math.min(88, Number(result.progress) > 0 ? Math.max(18, Math.min(88, result.progress)) : byTime),
      stage: result.message ? '生成中 · ' + String(result.message).slice(0, 40) : '生成中…',
    });
  }
  if (!result || result.status !== 'success') throw new Error('管理器生成超时或未返回成片');

  job.stage = '下载成片…';
  touch(job, { progress: 92 });
  await saveRemoteVideo(job, channel, submitted.taskId, platform, submitted.account.name, ctx);
  job.stage = '完成';
}


async function resumeJob(job,ctx) {
  const {channels,touch,log,failJob,flushState,pump}=ctx;
  if (!job || job.provider !== 'manager' || !job.remotePromptId) throw new Error('任务没有可继续的管理器编号');
  // 排队中但被锁住的任务也要能继续：锁定只是挡住自动排队，不应该挡住手动继续。
  if (!['failed', 'canceled', 'interrupted', 'queued'].includes(job.status)) throw new Error('任务正在生成中或已完成');
  const channel = channels.get('video', job.channelId);
  if (!channel) throw new Error('管理器渠道已删除');

  // 先拿管理器任务 id 去查它到底有没有出片：已经出片就直接取回，不进队列也不重新生成。
  const remote = await managerVideo.poll(channel, job.remotePromptId);
  if (remote.status === 'success') {
    job.status = 'running';
    job.stage = '取回成片…';
    job.progress = 90;
    job.held = false;
    job.error = null;
    job.failureAnalysis = null;
    job.resumeRemote = true;
    job.finishedAt = null;
    touch(job);
    log(job, 'info', '管理器任务已生成，直接取回成片（不重新生成）');
    try {
      await saveRemoteVideo(job, channel, job.remotePromptId, job.platform || 'doubao', '原任务账号',ctx);
      job.status = 'success';
      job.stage = '完成';
      job.progress = 100;
      job.finishedAt = Date.now();
      log(job, 'success', '任务完成：' + job.outputs.map((o) => o.name).join(', '));
      flushState();
    } catch (err) {
      failJob(job, err);
      throw err;
    }
    return job;
  }

  // 还没出片：远程仍在生成就直接排队等结果；远程已失败才让管理器续查原会话。
  if (remote.status === 'failed') await managerVideo.resume(channel, job.remotePromptId);
  job.resumeRemote = true; job.status = 'queued'; job.stage = '继续查询原任务';
  job.error = null; job.finishedAt = null; job.held = false;
  log(job, 'info', '继续原管理器任务 ' + job.remotePromptId + '，不重新生成');
  touch(job); setImmediate(pump); return job;
}


module.exports={workflows,execute,resumeJob,saveRemoteVideo,test:managerVideo.test,submit:managerVideo.submit,poll:managerVideo.poll,cancel:managerVideo.cancel,resume:managerVideo.resume,slots(ch,cfg){const out=[];const count=Math.max(1,Math.min(10,Number(cfg.concurrency)||3));for(const platform of ['doubao','gemini'])for(let i=1;i<=count;i++)out.push({key:'ch:'+ch.id+':'+platform+':'+i,provider:'manager',id:ch.id,platform,name:ch.name+' · '+(managerVideo.PLATFORM_LABEL[platform]||platform)+(count>1?' #'+i:'')});return out;}};
