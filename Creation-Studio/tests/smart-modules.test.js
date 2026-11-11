'use strict';
// 左侧一级菜单：智能剪辑 / 智能上剧 是真路由，点进去有页面，不是摆着好看的装饰
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../web/index.html'), 'utf8');
const source = require('./helpers/app-source')();

function rail() {
  const at = html.indexOf('<nav class="wmd-rail"');
  const end = html.indexOf('</nav>', at);
  assert.ok(at > 0 && end > at, '找不到一级菜单');
  return html.slice(at, end);
}

test('一级菜单里有智能剪辑和智能上剧', () => {
  const nav = rail();
  assert.match(nav, /data-route="smartcut"[\s\S]*?<span>智能剪辑<\/span>/);
  assert.match(nav, /data-route="smartrelease"[\s\S]*?<span>智能上剧<\/span>/);
});

test('两个菜单排在创作流程之后、素材库之前', () => {
  const order = [...rail().matchAll(/data-route="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, [
    'image', 'studio', 'script', 'oneclick', 'smartcut', 'smartrelease',
    'assets', 'tasks', 'media', 'compare',
  ]);
});

test('Ctrl 序号跟着 DOM 顺序走，第十个落在 0 上', () => {
  const nav = rail();
  const delay = [...nav.matchAll(/style="--i:(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(delay, delay.map((_, k) => k), '--i 必须从 0 连续');
  const tips = [...nav.matchAll(/title="[^"]* \(Ctrl\+(\d+)\)"/g)].map((m) => Number(m[1]));
  // Ctrl+10 按不出来，第 10 个用 Ctrl+0
  assert.deepEqual(tips, [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
});

test('一键成片的二级菜单是三个模式，切换靠 __oneclickSetMode', () => {
  const nav = fs.readFileSync(path.join(__dirname, '../web/shell-nav.js'), 'utf8');
  const menu = nav.slice(nav.indexOf('oneclick: {'), nav.indexOf('assets: {'));
  ['小说模式', '剧本模式', '灵感模式'].forEach((label) => assert.match(menu, new RegExp(`label: '${label}'`)));
  assert.match(menu, /value: 'novel'/);
  assert.match(nav, /route === 'oneclick'[\s\S]{0,120}?state\.oneclick\.mode/, '二级菜单要高亮当前模式');
  assert.match(nav, /shellRoute === 'oneclick'[\s\S]{0,120}?__oneclickSetMode/, '点模式要走切换钩子');
  assert.match(source, /window\.__oneclickSetMode = \(mode\) =>/);
});

test('一键成片三个模式只有入参不同，页面按模式渲染', () => {
  const modes = source.slice(source.indexOf('const ONECLICK_MODES = ['), source.indexOf('const state = {'));
  assert.match(modes, /id: 'novel', name: '小说模式'/);
  assert.match(modes, /id: 'script', name: '剧本模式'/);
  assert.match(modes, /id: 'idea', name: '灵感模式'/);
  assert.match(source, /'oneclick', 'smartcut'/, '路由白名单要收');
  assert.match(source, /state\.route === 'oneclick'\) html = /, 'render 要有分支');
  const page = source.slice(source.indexOf('function renderOneClick('), source.indexOf('/* -------------------------------------------------- 智能剪辑'));
  assert.match(page, /<h1>一键成片<\/h1>/);
  assert.match(page, /mode\.name/, '标题跟着模式走');
  assert.match(page, /mode\.input/, '入参跟着模式走');
  assert.doesNotMatch(page, /<textarea|<input/, '这一轮只做菜单，不填输入区');
});

test('两个路由真的能渲染出页面', () => {
  assert.match(source, /'smartcut', 'smartrelease'/, '路由白名单要收');
  assert.match(source, /state\.route === 'smartcut'\) html = /, 'render 要有分支');
  assert.match(source, /state\.route === 'smartrelease'\) html = /);
  // 智能剪辑是对话页（宿主 + 模块），标题和布局在 web/smartcut.js 里，不再用 page-head
  const cut = source.slice(source.indexOf('function renderSmartCut('), source.indexOf('function renderSmartRelease('));
  assert.match(cut, /class="sc-page"/, '智能剪辑给自己留一个撑满高度的宿主');
  assert.doesNotMatch(cut, /page-head/, '对话页不该套普通页头');
  const rel = source.slice(source.indexOf('function renderSmartRelease('), source.indexOf('ask 页复刻'));
  assert.match(rel, /<h1>智能上剧<\/h1>/);
});
