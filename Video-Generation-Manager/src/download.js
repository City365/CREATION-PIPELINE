'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
function probeFile(file, ffprobe) {
  return new Promise((resolve, reject) => execFile(ffprobe, ['-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json',file],
    { windowsHide: true, timeout: 30000, maxBuffer: 1048576 }, (error, stdout) => {
      if (error) return reject(new Error('视频完整性/时长检查失败，请检查ffprobe路径或下载文件'));
      try {
        const data = JSON.parse(stdout), duration = Number(data.format?.duration);
        if (!(duration > 0) || !data.streams?.some(s => s.codec_type === 'video')) throw new Error('文件没有有效视频轨道或时长');
        resolve({ duration, streams: data.streams });
      } catch (e) { reject(e); }
    }));
}
async function validateMP4(file, ffprobe) {
  const handle = await fs.promises.open(file, 'r');
  try {
    const header = Buffer.alloc(64); const { bytesRead } = await handle.read(header,0,64,0);
    if (bytesRead < 12 || header.subarray(0,bytesRead).indexOf('ftyp') < 0) throw new Error('下载结果不是MP4文件');
  } finally { await handle.close(); }
  return probeFile(file, ffprobe);
}
async function downloadVideo({ url, page, destination, signal, ffprobe, allowLocal = false, getDispatcher }) {
  const temp = destination + '.part'; let current = new URL(url); let response;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try {
    for (let i=0;i<6;i++) {
      signal?.throwIfAborted();
      if (current.protocol !== 'https:' && !(allowLocal && current.protocol === 'http:' && current.hostname === '127.0.0.1')) throw new Error('视频下载地址必须使用HTTPS');
      const cookies = await page.context().cookies(current.href);
      const headers = { Referer: page.url(), 'User-Agent': await page.evaluate(() => navigator.userAgent) };
      if (cookies.length) headers.Cookie = cookies.map(c => c.name+'='+c.value).join('; ');
      response = await fetch(current, { headers, dispatcher:getDispatcher?.(current.href), redirect:'manual', signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(300000)]) });
      if ([301,302,303,307,308].includes(response.status)) {
        const location=response.headers.get('location');await response.body?.cancel();
        if (!location) throw new Error('视频重定向地址缺失'); current = new URL(location,current); continue;
      }
      if (!response.ok) throw new Error('视频下载失败：HTTP '+response.status);
      break;
    }
    if (!response?.ok || !response.body) throw new Error('视频下载重定向次数过多');
    let bytes = 0;
    const guard = new Transform({ transform(chunk,encoding,cb) {
      bytes += chunk.length; cb(bytes > 1024*1024*1024 ? new Error('视频超过1GB下载限制') : null, chunk);
    }});
    await pipeline(Readable.fromWeb(response.body), guard, fs.createWriteStream(temp, { flags:'wx' }), { signal });
    signal?.throwIfAborted();
    const checked = await validateMP4(temp, ffprobe);
    signal?.throwIfAborted(); await fs.promises.rename(temp,destination);
    return { path: path.resolve(destination), size:bytes, duration:checked.duration };
  } finally { await fs.promises.unlink(temp).catch(e => { if(e.code!=='ENOENT') throw e; }); }
}
module.exports = { downloadVideo, validateMP4, probeFile };
