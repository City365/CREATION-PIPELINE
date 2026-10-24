'use strict';
/** 风格库：从 风格前置提示词.xlsx 导入，data/styles.json + data/styles/images/*.png。 */
const fs = require('node:fs');
const path = require('node:path');

function dataDir() {
  return path.join(__dirname, '..', 'data');
}

function imagePath(style) {
  if (!style || !style.image) return '';
  return path.join(dataDir(), String(style.image).replace(/^data\//, ''));
}

function file() {
  return path.join(dataDir(), 'styles.json');
}

function load() {
  try {
    const list = JSON.parse(fs.readFileSync(file(), 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function all() {
  return load().sort((a, b) => (a.order || 0) - (b.order || 0));
}

function get(id) {
  return all().find((s) => s.id === id) || null;
}

const SUMMARY_MAX = 160;

function publicStyle(style) {
  if (!style) return null;
  return {
    id: style.id,
    name: style.name,
    summary: String(style.summary || '').slice(0, SUMMARY_MAX),
    image: style.image || '',
    order: style.order || 0,
  };
}

function detail(style) {
  if (!style) return null;
  return { ...publicStyle(style), character: style.character, scene: style.scene, prop: style.prop, video: style.video };
}

const LAYERS = {
  character: (s) => s.character,
  scene: (s) => s.scene,
  prop: (s) => s.prop,
  video: (s) => s.video,
};

function layerFor(text) {
  const value = String(text || '');
  if (/角色|人物|身份板|立绘|形象/.test(value)) return 'character';
  if (/场景|环境|背景|地点/.test(value)) return 'scene';
  if (/道具|物品|物件|武器/.test(value)) return 'prop';
  return 'video';
}

/** 取一条风格前置；layer 可显式指定 character/scene/prop/video。 */
function promptFor(styleId, { layer = 'auto', text = '' } = {}) {
  const style = get(styleId);
  if (!style) return '';
  const key = layer && layer !== 'auto' && LAYERS[layer] ? layer : layerFor(text);
  return String(LAYERS[key](style) || '').trim();
}

module.exports = { all, get, publicStyle, detail, promptFor, layerFor, imagePath };
