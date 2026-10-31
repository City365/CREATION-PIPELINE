import { Device, PAGE } from './src/device.mjs';
const d = new Device();
const out = await d.evaluate([
  '(() => {',
  '  const bottom = document.querySelector("[data-testid=sidebar_bottom]");',
  '  const chip = [...document.querySelectorAll("[data-testid=sidebar_bottom] > *, [data-testid=flow_chat_sidebar] button")]',
  '    .filter(e => e.getClientRects().length)',
  '    .map(e => ({ tag: e.tagName, testid: e.getAttribute("data-testid"), aria: e.getAttribute("aria-label"), text: (e.innerText||"").replace(/\s+/g," ").slice(0,40), cls: String(e.className).slice(0,50) }));',
  '  return { bottomHtml: bottom ? bottom.outerHTML.slice(0, 1200) : null, chip };',
  '})()',
].join(String.fromCharCode(10)));
console.log(JSON.stringify(out, null, 1).slice(0, 3500));
d.client && d.client.close();
