'use strict';
/**
 * 测试辅助：一次拿到「完整的前端源码」。
 *
 * web/app.js 已按域拆成 app.core.js / app.studio.js / app.ask.js … 多个 classic script
 * （原 13,617 行单文件，435 个顶层函数）。那些按字符串断言的测试（render 分支、函数块、
 * 路由白名单）不该关心代码躺在哪个文件里，所以这里沿用 index.html 的真实加载顺序
 * 把它们拼回去，测试面对的还是同一份源码。
 *
 * 用法： const source = require('./helpers/app-source')();
 */
const fs = require('node:fs');
const path = require('node:path');

const WEB = path.join(__dirname, '..', '..', 'web');

module.exports = function appSource() {
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const names = [];
  const re = /<script src="\/(app[\w.-]*\.js)\?[^"]*"><\/script>/g;
  let m;
  while ((m = re.exec(html))) names.push(m[1]);
  if (!names.length) throw new Error('index.html 里找不到任何 app*.js，前端拆分可能被改坏了');
  return names.map((name) => fs.readFileSync(path.join(WEB, name), 'utf8')).join('\n;\n');
};
