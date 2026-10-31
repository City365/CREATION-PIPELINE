import { Device } from './src/device.mjs';
const d = new Device({ paceMs: 800 });
const convs = await d.evaluate([
  '(() => {',
  '  const items = [...document.querySelectorAll("[data-testid=conversation-list-v2-item]")];',
  '  return { url: location.href, total: items.length, top: items.slice(0, 6).map(el => ({ id: el.getAttribute("data-conversation-id"), text: (el.innerText || "").split(String.fromCharCode(10)).filter(Boolean)[0] })) };',
  '})()',
].join(String.fromCharCode(10)));
console.log(JSON.stringify(convs, null, 1));
d.client && d.client.close();
