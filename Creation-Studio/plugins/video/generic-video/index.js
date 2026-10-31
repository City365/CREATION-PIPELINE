'use strict';
const fs=require('node:fs'),path=require('node:path');
const genericVideo=require('./protocol');
function workflows(channel) {
 const channels={list:()=>[channel]};
  return channels.list('video')
    .filter((ch) => ch.enabled && ch.type !== 'manager-video' && ch.type !== 'autodl-h3')
    .map((ch) => {
      const opts = ch.options || {};
      const durationDefault = Math.max(1, Math.min(15, Number(opts.seconds) || 10));
      return {
        id: 'ch:' + ch.id,
        channelId: ch.id,
        provider: 'generic',
        label: ch.name,
        note: ch.type === 'generic-task' ? '自定义任务式接口' : 'OpenAI 视频兼容接口',
        images: Math.max(1, Math.min(9, Number(opts.maxImages) || 1)),
        audios: 0,
        videos: 0,
        durationKey: 'duration',
        durationDefault,
        durationOptions: Array.from({ length: 15 }, (_, i) => i + 1),
        seedKey: 'seed',
        sizeMode: 'wh',
        widthKey: '',
        heightKey: '',
        megapixelsOptions: [],
        megapixelsDefault: 0,
        megapixelsLabel: '尺寸',
        aspectKey: '',
        channelType: ch.type,
      };
    });
}

async function execute(ctx) {
  const {config,channels,job,workflow:wf,signal:a,slot,touch,log,checkCanceled,sleep,timeoutMs:JOB_TIMEOUT_MS,dataUrl,formatBytes,jobDir,saveOutputs,writeJobMeta,outputName,workbenchStore}=ctx;
  const {fetchBuffer}=ctx;
  const configuredChannel=channels.get('video',slot.id);
  const channel=configuredChannel&&{...configuredChannel,model:job.model||configuredChannel.model};
  if (!channel) throw new Error('视频渠道已删除，请重新选择');
  job.apiUrl = channel.baseUrl;
  job.stage = '提交到自定义渠道…';
  touch(job, { progress: 10 });
  log(job, 'info', `使用渠道「${channel.name}」（${channel.type}）提交`);
  const submitted = await genericVideo.submit(channel, job);
  job.remotePromptId = submitted.taskId;
  log(job, 'info', '任务已提交：id=' + submitted.taskId);
  touch(job, { progress: 20, stage: '生成中…' });

  const started = Date.now();
  let result = null;
  while (Date.now() - started < JOB_TIMEOUT_MS) {
    checkCanceled(job, a);
    await sleep(4000);
    checkCanceled(job, a);
    result = await genericVideo.poll(channel, submitted.taskId);
    if (result.status === 'failed') throw new Error('渠道任务失败：' + (result.message || result.rawStatus));
    if (result.status === 'success') break;
    const byTime = 20 + Math.round((Date.now() - started) / 1000 / 8);
    touch(job, {
      progress: Math.min(88, Number.isFinite(result.progress) && result.progress > 0 ? Math.max(20, Math.min(88, result.progress)) : byTime),
      stage: '生成中…',
    });
  }
  if (!result || result.status !== 'success') throw new Error('生成超时或渠道未返回结果');

  job.stage = '下载结果…';
  touch(job, { progress: 90 });
  const dir = jobDir(job);
  job.outputDir = dir;
  const url = result.url || genericVideo.downloadUrl(channel, submitted.taskId);
  const absolute = /^https?:\/\//i.test(url) ? url : channel.baseUrl.replace(/\/+$/, '') + (url.startsWith('/') ? '' : '/') + url;
  const headers = {};
  if (channel.apiKey) headers.Authorization = 'Bearer ' + String(channel.apiKey).replace(/^\s*Bearer\s+/i, '').trim();
  const res = await fetchBuffer(absolute, { headers, timeoutMs: 300000 });
  let ext = '.mp4';
  try {
    ext = path.extname(new URL(absolute).pathname) || '.mp4';
  } catch { /* keep mp4 */ }
  if (!/^\.(mp4|webm|mov|m4v)$/i.test(ext)) ext = /webm/i.test(res.contentType) ? '.webm' : '.mp4';
  const name = outputName(job, 'video', ext.toLowerCase());
  const file = path.join(dir, name);
  fs.writeFileSync(file, res.buffer);
  job.outputs.push({ type: 'video', name, path: file, bytes: res.buffer.length, url: absolute });
  log(job, 'info', `已下载 ${name}（${formatBytes(res.buffer.length)}）`);
  writeJobMeta(job, dir, {
    apiUrl: channel.baseUrl,
    worker: channel.name,
    inputValues: {
      channelId: channel.id,
      channel: channel.name,
      type: channel.type,
      model: channel.model,
      size: genericVideo.sizeFor(job.aspectRatio),
      duration: job.duration,
      seed: job.seed,
    },
  });
  job.stage = '完成';
}


module.exports={workflows,execute,test:genericVideo.test,submit:genericVideo.submit,poll:genericVideo.poll,slots:ch=>[{key:'ch:'+ch.id,provider:'generic',id:ch.id,name:ch.name}]};
