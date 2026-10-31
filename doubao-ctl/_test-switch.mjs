import { Device } from './src/device.mjs';
const d = new Device({ paceMs: 1000, log: (m) => console.log('[dev] ' + m) });
const list0 = await d.listAccounts();
console.log('start current=' + list0.current + ' accounts=' + list0.accounts.map(a => a.name).join(','));
for (const name of ['用户490936', '用户vwYK1j', '用户490936']) {
  const t0 = Date.now();
  try {
    const r = await d.switchAccount(name);
    console.log('switch ' + name + ' -> ' + JSON.stringify(r) + ' ' + (Date.now() - t0) + 'ms');
  } catch (err) {
    console.log('switch ' + name + ' FAILED: ' + err.message + ' ' + (Date.now() - t0) + 'ms');
  }
  await new Promise(r => setTimeout(r, 1000));
}
d.client && d.client.close();
process.exit(0);
