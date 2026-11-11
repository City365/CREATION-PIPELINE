'use strict';
// 右侧组件技能面板与插件管理共用同一份技能来源（/agent/skills）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = require('./helpers/app-source')();

test('技能清单来自统一接口，工作区改为文件视图', () => {
  assert.ok(source.includes("askApi('/skills')"), '要拉取统一技能清单');
  const list = source.slice(source.indexOf('function askSkillList()'), source.indexOf('function askSkill('));
  assert.ok(list.includes('a.skills'), '清单优先用服务端数据');
  const panel = source.slice(source.indexOf('function askCapabilityHtml('), source.indexOf('function askFilePaneHtml('));
  assert.ok(panel.includes('AgentWorkspace.html'), '右侧工作区展示当前会话文件');
  assert.ok(panel.includes('askSummaryHtml') && panel.includes('askWorkspaceContext'), '摘要和独立工作区分开');
  const manage = source.slice(source.indexOf("const systemSkills ="), source.indexOf('const row = (item, isSystem)'));
  assert.ok(manage.includes('a.skills'), '插件管理的系统内置也读同一份数据');
  assert.equal(/const systemSkills = ASK_SKILLS/.test(source), false, '不应再直接写死 ASK_SKILLS');
});

test('安装技能：入口、对话框、接口调用都在', () => {
  assert.ok(source.includes('data-act="ask-skill-install"'), '插件管理要有安装入口');
  assert.ok(source.includes('function askInstallSkillHtml('), '需要安装对话框');
  const save = source.slice(source.indexOf('async function askSaveInstallSkill('), source.indexOf('function askFolderDialogHtml('));
  assert.ok(save.includes("askApi('/skills/install'"), '调用安装接口');
  assert.ok(save.includes('await askLoadSkills()'), '装完刷新技能清单');
  assert.ok(save.includes('await askLoadManage()'), '装完刷新插件管理');
  assert.ok(save.includes('60000') || source.includes('上限 60000 字符'), '界面要说明长度上限');
});

test('安装对话框在插件管理页也能渲染出来', () => {
  const at = source.indexOf("if (a.workspacePage !== 'console')");
  assert.ok(at > 0, '找不到管理页渲染分支');
  const early = source.slice(at, at + 800);
  assert.ok(early.includes('askInstallSkillHtml()'), '管理页的渲染分支也要带上弹窗');
});

test('支持从 .md 文件导入技能内容', () => {
  assert.ok(source.includes("id=\"ask-install-file\""), '要有文件选择框');
  const bind = source.slice(source.indexOf("const installFileInput = $('#ask-install-file')"), source.indexOf("const fileInput = $('#ask-file')"));
  assert.ok(bind.includes('FileReader'), '要读取文件内容');
  assert.ok(bind.includes('d.content'), '文件内容填进对话框');
});

test('完整技能支持上传 zip 压缩包，由后端解压', () => {
  assert.ok(source.includes('id="ask-bundle-zip"'), '完整技能要有 zip 文件框');
  assert.ok(source.includes('async function askUpload('), '要有 multipart 上传方法');
  const save = source.slice(source.indexOf("await askUpload('/skills/upload'"), source.indexOf("const entry =", source.indexOf("await askUpload('/skills/upload'")));
  assert.ok(save.includes('FormData') || source.includes('new FormData()'), '用 FormData 上传');
  assert.ok(source.includes("form.append('file', zipFile)"), '要上传 zip 文件本身');
  assert.ok(source.includes('askLoadSkills()'), '导入后刷新技能清单');
});
