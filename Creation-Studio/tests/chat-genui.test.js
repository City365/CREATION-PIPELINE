'use strict';
// 豆包系模型会把交互组件源码（GenUI / DIL）直接写进回复。这里校验前端把它们还原成
// 真实控件，而不是在对话里露出一堆标签。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = require('./helpers/app-source')();
const start = source.indexOf('/* ------------------- 对话里的交互组件');
const end = source.indexOf('function askMessagesHtml(chat) {');
assert.ok(start > 0 && end > start, '在 app.js 里找不到交互组件解析段落');

const prelude = `
const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function mdInline(text) { let html = esc(text); html = html.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>'); return html; }
function askMarkdown(text) { return '<p>' + mdInline(text) + '</p>'; }
function toast() {}
const __store = new Map();
const localStorage = {
  getItem: (k) => (__store.has(k) ? __store.get(k) : null),
  setItem: (k, v) => { __store.set(k, String(v)); },
  removeItem: (k) => { __store.delete(k); },
};
// 模拟「本机已经记住过一张图」：脚本加载时就要能还原，不能在 const 初始化前访问
__store.set('wmd.refImages', JSON.stringify({
  'seed-1': { url: '/api/file?path=seed.png', path: 'seed.png', ratio: '9:16' },
  'seed-2': { url: '/api/file?path=seed2.png', path: 'seed2.png' },
}));
`;
const box = {};
new Function('module', 'exports', prelude + source.slice(start, end) + `
module.exports = { guHtmlFor, guPlainText, guEvalExpr, guStateDecls, guSegments, guFixStrayTags,
  guRefKey, guRefCardHtml, guRefStoreSave, guRefStoreHydrate, ASK_REF_CACHE, GU_REF_RATIOS, __store };
`)(box, box.exports);
const gu = box.exports;

const SAMPLE = `## 四、你更喜欢哪一种秋风萧瑟的美感？

{@body const [style,setStyle] = DIL.useState("诗意苍凉")}
{@body const [ratio,setRatio] = DIL.useState("9:16 竖屏壁纸")}
<box border radius="xl" padding={4} gap={4}>
  <text weight="medium">1. 整体氛围</text>
  <radio-group value={style} onChange={setStyle} direction="col">
    <radio value="诗意苍凉">诗意苍凉，像古诗词里的秋天</radio>
    <radio value="电影高级感">电影高级感，低饱和、强氛围</radio>
  </radio-group>
  <divider color="subtle"/>
  <button block onClick={() => GenUI.issueNewTurn("氛围："+style+"；比例："+ratio)}>生成专属提示词</button>
</box>`;

test('交互组件被还原成控件而不是裸标签', () => {
  const html = gu.guHtmlFor(SAMPLE, { id: 'm1' });
  assert.ok(html.includes('class="gu-card"'), '应输出卡片容器');
  assert.ok(!html.includes('{@body'), '不应残留状态声明');
  assert.ok(!/<box|<radio-group|<radio\s|<text\b|<divider/.test(html), '不应残留原始标签');
  assert.equal((html.match(/class="gu-option[" ]/g) || []).length, 2);
  assert.ok(html.includes('data-gu-key="style"'));
  assert.ok(html.includes('gu-option is-on'), '默认值应被选中');
  assert.ok(html.includes('data-act="gu-run"'));
  assert.ok(html.includes('生成专属提示词'));
  assert.ok(html.includes('## 四、你更喜欢哪一种秋风萧瑟的美感？'), '正文段落照常渲染');
});

test('动作按钮的表达式只做字符串拼接，不执行任意代码', () => {
  const text = gu.guEvalExpr('() => GenUI.issueNewTurn("氛围："+style+"；比例："+ratio)', { style: '诗意苍凉', ratio: '9:16 竖屏壁纸' });
  assert.equal(text, '氛围：诗意苍凉；比例：9:16 竖屏壁纸');
  assert.equal(gu.guEvalExpr('() => GenUI.copy("原样复制")', {}), '原样复制');
  assert.equal(gu.guEvalExpr('() => GenUI.issueNewTurn("a"+missing+"b")', {}), 'ab');
});

test('复制型按钮走复制动作，不触发新一轮对话', () => {
  const html = gu.guHtmlFor('<box><button onClick={() => GenUI.copy("一段提示词")}>复制提示词</button></box>', { id: 'm2' });
  assert.ok(html.includes('data-act="gu-copy"'));
  assert.ok(!html.includes('data-act="gu-run"'));
});

test('流式输出未闭合时给出占位，不闪出一堆标签', () => {
  const partial = gu.guHtmlFor('正在整理：\n<box gap={4}>\n  <text>写在前面</text>\n', { id: 'm3' });
  assert.ok(partial.includes('gu-card-pending'));
  assert.ok(!partial.includes('<text'), '未闭合的标签不应外泄');
});

test('普通回复不受影响', () => {
  const html = gu.guHtmlFor('就是一段普通回复，含 < 号和 **加粗**。', { id: 'm4' });
  assert.ok(html.includes('gu-card') === false);
  assert.ok(html.includes('<strong>加粗</strong>'));
});

test('表格与网格类组件也能落地', () => {
  const html = gu.guHtmlFor(`{@body const [k,setK] = DIL.useState("a")}
<grid columns={2} gap={3}>
  <grid-item><badge>唯美治愈</badge><text>说明一</text></grid-item>
  <grid-item><text>说明二</text></grid-item>
</grid>`, { id: 'm5' });
  assert.ok(html.includes('gu-grid') && html.includes('data-cols="2"'));
  assert.ok(html.includes('gu-grid-item'));
  assert.ok(!html.includes('<grid'));
});

test('自闭合的 <AsyncImageGroup /> 也还原成画面参考卡', () => {
  const html = gu.guHtmlFor('这就是效果图：\n\n<AsyncImageGroup query={["水墨秋山 云雾","红叶溪流"]} aspectRatio="5:4" layout="bento" size="lg"/>\n\n喜欢的话继续。', { id: 'm6' });
  assert.ok(!html.includes('AsyncImageGroup'), '不应残留原始标签');
  assert.ok(html.includes('gu-grid'));
  assert.ok(html.includes('水墨秋山 云雾'));
  assert.ok(html.includes('红叶溪流'));
});

test('复制正文时去掉组件源码但保留提示词内容', () => {  const plain = gu.guPlainText(`${SAMPLE}\n\n<grid columns={2}><grid-item><text>秋日深林，落叶飞舞</text></grid-item></grid>`);
  assert.ok(!plain.includes('{@body'));
  assert.ok(!plain.includes('<box'));
  assert.ok(plain.includes('秋日深林，落叶飞舞'));
  assert.ok(plain.includes('## 四、你更喜欢哪一种秋风萧瑟的美感？'));
});

/* ------------------- 格式协议：正文 / 组件混排 ------------------- */

test('正文里单独出现的 <AsyncImage /> 变成参考卡，不露出标签', () => {
  const text = `版本A：《你死后的第九十九天》

<AsyncImage query="cinematic Korean fantasy romance drama lonely young woman rain streaked window" aspectRatio="16:9" width="100%"/>

<text color="secondary" size="sm">类型：奇幻爱情 · 悬疑 · 虐心治愈</text>

第一集：来自死者的消息`;
  const html = gu.guHtmlFor(text, { id: 'p1' });
  assert.ok(!html.includes('AsyncImage'), '标签不能漏进正文');
  assert.ok(!html.includes('aspectRatio'), '属性不能漏进正文');
  assert.ok(!/<text\b/.test(html), '<text> 不能漏进正文');
  assert.ok(html.includes('cinematic Korean fantasy romance'), '画面描述要落到卡片上');
  assert.ok(html.includes('gu-ref'), '应渲染成画面参考卡');
  assert.ok(html.includes('类型：奇幻爱情'), '文字组件照常显示');
  assert.ok(html.includes('gu-text is-sm') && html.includes('is-muted'), 'size/color 生效');
  // 顺序不能乱：正文 → 卡片 → 小字 → 正文
  const order = ['版本A：', 'gu-ref', '类型：奇幻爱情', '第一集：来自死者的消息'].map((k) => html.indexOf(k));
  assert.ok(order.every((v) => v >= 0), '四段内容都要在');
  assert.deepEqual([...order].sort((a, b) => a - b), order, '混排顺序保持原样');
});

test('单标签组件贴正文排，不套卡片边框', () => {
  const html = gu.guHtmlFor('前一句。\n\n<text>一句独立的说明</text>\n\n后一句。', { id: 'p2' });
  assert.ok(html.includes('class="gu-inline"'), '叶子组件用贴正文容器');
  assert.ok(!html.includes('class="gu-card"'), '不要多套一层卡片');
  assert.equal((html.match(/data-gu-msg="p2"/g) || []).length, 1);
});

test('标签名大小写与别名都能识别', () => {
  const html = gu.guHtmlFor(`<Card>
  <Column>
    <Text weight="bold">标题</Text>
    <GridItem><Tag>治愈</Tag></GridItem>
  </Column>
</Card>`, { id: 'p3' });
  assert.ok(!/<Card|<Column|<Text|<GridItem|<Tag/.test(html), '不应残留原始标签');
  assert.ok(html.includes('class="gu-card"'));
  assert.ok(html.includes('gu-grid-item'));
  assert.ok(html.includes('gu-tag'));
  assert.ok(html.includes('标题'));
});

test('白名单外的组件标签一律吞掉，不留在正文里', () => {
  const html = gu.guHtmlFor('说明：\n\n<VideoPlayer src="/api/media/a.mp4" autoplay/>\n\n<Foo bar="1">内部文字</Foo>\n\n结束。', { id: 'p4' });
  assert.ok(!html.includes('VideoPlayer'));
  assert.ok(!html.includes('autoplay'));
  assert.ok(!html.includes('Foo bar'));
  assert.ok(html.includes('说明：') && html.includes('结束。'));
});

test('正文里的素材编号与台词标记必须原样保留', () => {
  const text = '参考 <Picture 1> 与 <Subject 2>，台词：<d>[Chinese] 你终于来了。</d>，镜头 [Shot 1]。';
  const html = gu.guHtmlFor(text, { id: 'p5' });
  assert.ok(html.includes('&lt;Picture 1&gt;'), '<Picture N> 不能被吞');
  assert.ok(html.includes('&lt;Subject 2&gt;'));
  assert.ok(html.includes('&lt;d&gt;[Chinese] 你终于来了。&lt;/d&gt;'));
  assert.ok(!html.includes('gu-card'), '纯正文不产生组件');
});

test('代码块里讨论的标签保持文字，不当组件执行', () => {
  const text = '这样写：\n\n```\n<text size="sm">示例</text>\n```\n\n就会变成小字。';
  const html = gu.guHtmlFor(text, { id: 'p6' });
  assert.ok(html.includes('&lt;text size='), '代码里的标签保持成文字');
  assert.ok(html.includes('示例'));
  assert.ok(!html.includes('class="gu-inline"') && !html.includes('class="gu-card"'), '不被当成组件执行');
});

test('流式中途未闭合的组件不闪标签，也不吞掉后面的正文', () => {
  const partial = '先看图：\n\n<AsyncImage query="a long cinematic frame description that keeps streaming" aspectRatio="16:9/>\n\n然后再说明。';
  const html = gu.guHtmlFor(partial, { id: 'p7' });
  assert.ok(!html.includes('AsyncImage'), '不露标签');
  assert.ok(!html.includes('aspectRatio'));
  assert.ok(html.includes('然后再说明'), '标签之后的正文照常渲染');
  assert.ok(html.includes('a long cinematic frame'), '已写出的描述落到卡片');
});

/* ------------------- 图片记忆：刷新后不再重新出图 ------------------- */

test('本机已有记录时，脚本初始化就要还原图与比例且不报 TDZ', () => {
  assert.ok(gu.ASK_REF_CACHE.get('seed-1'), '加载时就读回图片地址');
  assert.equal(gu.GU_REF_RATIOS.get('seed-1'), '9:16');
  assert.ok(gu.ASK_REF_CACHE.get('seed-2'));
  const html = gu.guRefCardHtml('本机已有图', '9:16');
  assert.equal(gu.guRefKey('本机已有图') === 'seed-1', false, '不同描述用不同 key');
  assert.ok(html.includes('data-gu-state="pending"'), '没有记忆的描述仍然是待生成');
});

test('已生成的图片记在本机，刷新后直接按已就绪渲染', () => {
  const prompt = 'persisted frame after reload';
  const key = gu.guRefKey(prompt);
  gu.GU_REF_RATIOS.set(key, '9:16');
  gu.ASK_REF_CACHE.set(key, { url: '/api/file?path=cached.png', path: 'cached.png' });
  gu.guRefStoreSave();

  // 模拟刷新：内存清空，只剩 localStorage
  gu.ASK_REF_CACHE.clear();
  gu.GU_REF_RATIOS.clear();
  gu.guRefStoreHydrate();

  const html = gu.guRefCardHtml(prompt);
  assert.ok(html.includes('data-gu-state="ready"'), '刷新后应直接是已就绪状态');
  assert.ok(html.includes('/api/file?path=cached.png'), '直接复用记住的图片地址');
  assert.ok(html.includes('data-gu-ratio="9:16"'), '图位比例也一起记住');
  assert.ok(!html.includes('gu-ref-spin'), '不再显示转圈出图中');
});

test('只记成功出图，失败记录不写进记忆', () => {
  gu.__store.clear();
  gu.ASK_REF_CACHE.clear();
  gu.ASK_REF_CACHE.set(gu.guRefKey('ok one'), { url: '/api/file?path=ok.png', path: 'ok.png' });
  gu.ASK_REF_CACHE.set(gu.guRefKey('failed one'), { error: '出图失败' });
  gu.guRefStoreSave();
  const saved = JSON.parse(gu.__store.get('wmd.refImages'));
  const values = Object.values(saved);
  assert.equal(values.length, 1, '失败的不进记忆');
  assert.ok(values[0].url.includes('ok.png'));
});

