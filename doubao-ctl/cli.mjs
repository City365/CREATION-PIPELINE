#!/usr/bin/env node
// Command line driver for the local Doubao desktop app.
import readline from 'node:readline';
import { DoubaoController, conversationIdOf } from './src/chat.mjs';
import { DEFAULT_EXE, runningPids } from './src/app.mjs';
import { DEFAULT_PORT, portAlive } from './src/cdp.mjs';

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
const args = argv.filter((a) => a !== '--json');
const command = args[0] || 'repl';

const controller = new DoubaoController({ exe: DEFAULT_EXE, port: DEFAULT_PORT, log: (m) => { if (!asJson) console.error('[doubao] ' + m); } });

function print(value) {
  if (asJson) console.log(JSON.stringify(value, null, 2));
}

async function withController(fn) {
  try {
    return await fn();
  } finally {
    controller.close();
  }
}

function help() {
  console.log([
    'doubao-ctl — 控制本地豆包客户端（D:\\notebook\\software\\Doubao）',
    '',
    '用法:',
    '  node cli.mjs status              连接状态 / 当前会话',
    '  node cli.mjs ensure              保证客户端带调试端口运行并连上',
    '  node cli.mjs ask "你好" [--timeout 180]   发一条消息并等待完整回复',
    '  node cli.mjs read [条数]         读取当前会话消息',
    '  node cli.mjs ls                  列出侧边栏会话',
    '  node cli.mjs new                 新建对话（Ctrl+Shift+K 等价）',
    '  node cli.mjs open <序号|标题片段> 切换到指定会话',
    '  node cli.mjs stop                中断正在生成的回复',
    '  node cli.mjs repl                交互式连续对话（默认，不带参数时进入）',
    '',
    '通用参数: --json 输出 JSON；--timeout 毫秒',
  ].join('\n'));
}

async function main() {
  const timeoutIdx = args.indexOf('--timeout');
  const timeoutMs = timeoutIdx >= 0 ? Number(args[timeoutIdx + 1]) : undefined;
  const positional = timeoutIdx >= 0 ? args.filter((a, i) => i !== timeoutIdx && i !== timeoutIdx + 1) : args.slice();

  if (command === 'help' || command === '--help' || command === '-h') return help();

  if (command === 'status') {
    return withController(async () => {
      const port = await portAlive(DEFAULT_PORT);
      const pids = await runningPids();
      if (!port.alive) {
        const out = { ok: false, cdp: false, port: DEFAULT_PORT, pids, message: '客户端未以调试端口运行，执行 ensure / ask 会自动重启一次' };
        if (asJson) print(out); else console.log('CDP 未开启（端口 ' + DEFAULT_PORT + '）；豆包进程: ' + (pids.join(',') || '未运行'));
        return;
      }
      const st = await controller.status();
      const out = Object.assign({ cdp: true, browser: port.browser, pids }, st);
      if (asJson) return print(out);
      console.log('CDP: 已连接 ' + out.browser + ' :' + DEFAULT_PORT);
      console.log('会话: ' + (out.conversationId || '(新对话页)'));
      console.log('生成中: ' + (out.busy ? '是' : '否') + '  消息数: ' + out.messages);
      console.log('当前地址: ' + out.url);
    });
  }

  if (command === 'ensure') {
    return withController(async () => {
      const st = await controller.status();
      if (asJson) return print({ ok: true, ...st });
      console.log('已就绪，会话 ' + (st.conversationId || '(新对话页)'));
    });
  }

  if (command === 'ask' || command === 'chat') {
    const text = positional.slice(1).join(' ');
    if (!text) { console.error('缺少消息内容，例如: node cli.mjs ask "你好"'); process.exitCode = 2; return; }
    return withController(async () => {
      const res = await controller.send(text, { timeoutMs, onProgress: asJson ? null : null });
      if (asJson) return print(res);
      if (!res.ok) console.error('[doubao] 等待超时（' + res.elapsedMs + 'ms），以下为已收到的部分:');
      console.log(res.text);
      console.error('--- 会话 ' + (res.conversationId || '?') + '，用时 ' + (res.elapsedMs / 1000).toFixed(1) + 's ---');
    });
  }

  if (command === 'read') {
    const limit = Number(positional[1]) || 20;
    return withController(async () => {
      const data = await controller.messages();
      const list = data.messages.slice(-limit);
      if (asJson) return print({ conversationId: data.conversationId, busy: data.busy, messages: list });
      console.log('会话 ' + (data.conversationId || '(新对话页)') + (data.busy ? '（生成中）' : ''));
      for (const m of list) {
        const who = m.role === 'user' ? '我' : m.role === 'assistant' ? '豆包' : '系统';
        console.log('\n[' + who + '] ' + m.text.trim());
      }
    });
  }

  if (command === 'ls') {
    return withController(async () => {
      const list = await controller.conversations();
      if (asJson) return print(list);
      list.forEach((c, i) => console.log(String(i).padStart(2) + (c.active ? ' *' : '  ') + ' ' + c.title));
    });
  }

  if (command === 'new') {
    return withController(async () => {
      const res = await controller.newChat();
      if (asJson) return print({ ok: true, ...res });
      console.log('已新建对话: ' + (res.conversationId || '(引导页，发送第一条消息后生成)'));
    });
  }

  if (command === 'open') {
    const key = positional[1];
    if (key === undefined) { console.error('用法: node cli.mjs open <序号|标题片段>'); process.exitCode = 2; return; }
    return withController(async () => {
      const res = await controller.openConversation(/^\d+$/.test(key) ? Number(key) : key);
      if (asJson) return print(res);
      console.log('已切换到「' + res.title + '」: ' + (res.conversationId || '?'));
    });
  }

  if (command === 'stop') {
    return withController(async () => {
      const res = await controller.stop();
      if (asJson) return print(res);
      console.log(res.ok ? '已请求中断' : '当前没有可中断的生成');
    });
  }

  if (command === 'repl') return repl(timeoutMs);

  console.error('未知命令: ' + command);
  help();
  process.exitCode = 2;
}

async function repl(timeoutMs) {
  await controller.ensureConnected();
  const st = await controller.status();
  console.log('已连接本地豆包（会话 ' + (st.conversationId || '新对话页') + '）');
  console.log('直接输入内容回车发送；/new 新对话  /read 查看  /ls 会话  /stop 中断  /exit 退出');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: '你 > ' });
  rl.prompt();
  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) return rl.prompt();
    if (text === '/exit' || text === '/quit') { rl.close(); return; }
    try {
      if (text === '/new') { const r = await controller.newChat(); console.log('新会话 ' + (r.conversationId || '(引导页)')); return rl.prompt(); }
      if (text === '/ls') { (await controller.conversations()).forEach((c, i) => console.log(String(i).padStart(2) + (c.active ? ' *' : '  ') + ' ' + c.title)); return rl.prompt(); }
      if (text === '/read') {
        const data = await controller.messages();
        for (const m of data.messages.slice(-10)) console.log('[' + (m.role === 'user' ? '我' : '豆包') + '] ' + m.text.trim());
        return rl.prompt();
      }
      if (text === '/stop') { await controller.stop(); console.log('已请求中断'); return rl.prompt(); }
      process.stdout.write('豆包 > ');
      const res = await controller.send(text, { timeoutMs });
      console.log(res.text);
      console.log('(' + (res.elapsedMs / 1000).toFixed(1) + 's)');
    } catch (err) {
      console.error('出错: ' + (err && err.message ? err.message : err));
    }
    rl.prompt();
  });
  rl.on('close', () => { controller.close(); process.exit(0); });
}

main().catch((err) => {
  console.error('致命错误: ' + (err && err.stack ? err.stack : err));
  process.exitCode = 1;
});
