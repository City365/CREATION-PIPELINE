import { Device } from './src/device.mjs';
import { DoubaoController } from './src/chat.mjs';
import { ClientQueue } from './src/queue.mjs';

const device = new Device({ paceMs: 1000, log: (m) => console.log('[dev] ' + m) });
const controller = new DoubaoController({ paceMs: 1000, log: (m) => console.log('[ctl] ' + m) });
const queue = new ClientQueue({ device, controller, stepMs: 1000, harvestDelayMs: 8000, tickMs: 1500, log: (m) => console.log(m) });
queue.on('change', (s) => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + JSON.stringify(s.counts) + ' current=' + (s.current || '-') + ' err=' + (s.lastError || '')));
queue.enqueue({ id: 'A', text: '只回复一个字：甲' });
queue.enqueue({ id: 'B', text: '只回复一个字：乙' });
queue.start();
const t0 = Date.now();
while (Date.now() - t0 < 360000) {
  await new Promise((r) => setTimeout(r, 3000));
  const s = queue.snapshot();
  if (s.counts.done === 2 || s.counts.failed > 0) break;
}
const s = queue.snapshot();
console.log('FINAL ' + JSON.stringify(s.tasks.map((t) => ({ id: t.id, status: t.status, account: t.account, conv: t.conversationId, reply: t.reply, err: t.error }))));
await queue.stop();
controller.close();
process.exit(0);
