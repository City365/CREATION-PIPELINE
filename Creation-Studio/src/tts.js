'use strict';
/**
 * 内置音色（离线 TTS）
 *
 * 用 Windows 自带的 System.Speech（SAPI）合成 WAV：不联网、不额外装依赖，
 * 装了什么语音包就能用什么音色（中文系统一般有 Microsoft Huihui）。
 * 生成的文件落在 uploadFolder/tts/ 下，和本地上传的音频走同一条链路。
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const config = require('./config');
const { ensureDir } = require('./util');

const IS_WIN = process.platform === 'win32';
let voiceCache = { at: 0, list: [] };

function runPowerShell(script, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (!IS_WIN) return reject(new Error('内置音色目前只在 Windows 上可用（System.Speech）'));
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try { ps.kill(); } catch { /* ignore */ }
      reject(new Error('语音合成超时'));
    }, timeoutMs);
    ps.stdout.on('data', (d) => { out += d.toString('utf8'); });
    ps.stderr.on('data', (d) => { err += d.toString('utf8'); });
    ps.on('error', (e) => { clearTimeout(timer); reject(e); });
    ps.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error((err || out || '语音合成失败').trim().split(/\r?\n/).slice(-3).join(' ')));
    });
  });
}

const LIST_SCRIPT = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.GetInstalledVoices() | ForEach-Object {
  $i = $_.VoiceInfo
  "$($i.Name)\`t$($i.Culture.Name)\`t$($i.Gender)"
}
$s.Dispose()
`;

async function listVoices({ refresh = false } = {}) {
  if (!refresh && voiceCache.list.length && Date.now() - voiceCache.at < 10 * 60 * 1000) return voiceCache.list;
  if (!IS_WIN) return [];
  const out = await runPowerShell(LIST_SCRIPT, 15000);
  const list = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const [name, locale, gender] = line.split('\t');
    const zh = /^zh/i.test(locale || '');
    return {
      id: name,
      name,
      locale: locale || '',
      gender: gender || '',
      label: `${name.replace(/^Microsoft\s+/, '').replace(/\s+Desktop$/, '')} · ${locale || ''}${gender ? ' · ' + gender : ''}`,
      short: name.replace(/^Microsoft\s+/, '').replace(/\s+Desktop$/, ''),
      zh,
      index,
    };
  }).sort((a, b) => Number(b.zh) - Number(a.zh) || a.name.localeCompare(b.name));
  voiceCache = { at: Date.now(), list };
  return list;
}

function wavSeconds(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(44);
    fs.readSync(fd, head, 0, 44, 0);
    fs.closeSync(fd);
    const byteRate = head.readUInt32LE(28);
    const size = fs.statSync(file).size - 44;
    if (!byteRate) return 0;
    return Math.round((size / byteRate) * 10) / 10;
  } catch {
    return 0;
  }
}

async function speak({ text, voice, rate = 0 } = {}) {
  const content = String(text || '').trim();
  if (!content) throw new Error('先写要读的文字');
  if (content.length > 4000) throw new Error('一段最多 4000 字，长台词分几段生成');
  const voices = await listVoices();
  if (!voices.length) throw new Error('这台机器没有可用的语音包（System.Speech）');
  const picked = voices.find((v) => v.id === voice) || voices.find((v) => v.zh) || voices[0];
  const speed = Math.max(-10, Math.min(10, Number(rate) || 0));

  const cfg = config.load();
  const dir = ensureDir(path.join(cfg.uploadFolder, 'tts'));
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const safe = content.replace(/[\r\n]+/g, ' ').slice(0, 18).replace(/[\\/:*?"<>|\s]+/g, '_') || 'line';
  const file = path.join(dir, `tts-${stamp}-${safe}.wav`);
  const textFile = path.join(os.tmpdir(), `wmd-tts-${Date.now()}.txt`);
  fs.writeFileSync(textFile, content, 'utf8');

  const script = `
Add-Type -AssemblyName System.Speech
$text = [IO.File]::ReadAllText('${textFile.replace(/\\/g, '\\\\')}', [Text.Encoding]::UTF8)
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('${String(picked.id).replace(/'/g, "''")}')
$s.Rate = ${speed}
$s.SetOutputToWaveFile('${file.replace(/\\/g, '\\\\')}')
$s.Speak($text)
$s.Dispose()
`;
  try {
    await runPowerShell(script, 120000);
  } finally {
    try { fs.unlinkSync(textFile); } catch { /* ignore */ }
  }
  if (!fs.existsSync(file)) throw new Error('没有生成音频文件');
  return {
    path: file,
    name: path.basename(file),
    bytes: fs.statSync(file).size,
    seconds: wavSeconds(file),
    voice: picked.id,
    voiceLabel: picked.label,
  };
}

module.exports = { listVoices, speak, IS_WIN };
