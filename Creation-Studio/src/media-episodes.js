'use strict';
/**
 * 媒体库分集：在项目下维护「集」以及每个成片归属哪一集。
 *
 * 只存归属关系，不移动、不复制实体文件——媒体库里的成片动辄几十 MB，
 * 而且任务记录里保存着绝对路径，搬文件会让这些记录失效。
 */
const path = require('node:path');
const config = require('./config');
const { readJson, writeJson, uid } = require('./util');

function storeFile() {
  return path.join(config.DATA, 'media-episodes.json');
}

function normalize(raw) {
  const data = { version: 1, projects: {} };
  if (!raw || typeof raw !== 'object' || !raw.projects || typeof raw.projects !== 'object') return data;
  for (const [projectId, row] of Object.entries(raw.projects)) {
    if (!row || typeof row !== 'object') continue;
    const episodes = Array.isArray(row.episodes)
      ? row.episodes
        .filter((item) => item && item.id)
        .map((item, index) => ({
          id: String(item.id),
          name: String(item.name || `第${index + 1}集`).slice(0, 60),
          number: Number(item.number) > 0 ? Number(item.number) : index + 1,
          createdAt: Number(item.createdAt) || Date.now(),
        }))
      : [];
    const items = {};
    if (row.items && typeof row.items === 'object') {
      for (const [rel, episodeId] of Object.entries(row.items)) {
        if (episodes.some((episode) => episode.id === episodeId)) items[String(rel)] = String(episodeId);
      }
    }
    data.projects[String(projectId)] = { episodes, items };
  }
  return data;
}

function read() {
  return normalize(readJson(storeFile(), null));
}

function write(data) {
  writeJson(storeFile(), data);
}

function rowOf(data, projectId) {
  const key = String(projectId || '');
  if (!data.projects[key]) data.projects[key] = { episodes: [], items: {} };
  const row = data.projects[key];
  if (!Array.isArray(row.episodes)) row.episodes = [];
  if (!row.items || typeof row.items !== 'object') row.items = {};
  return row;
}

function numberFromName(name, fallback) {
  const match = /第\s*(\d+)\s*集/.exec(String(name || ''));
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nextNumber(row) {
  const used = row.episodes.map((episode) => Number(episode.number) || 0);
  return Math.max(0, ...used) + 1;
}

function list(projectId) {
  const data = read();
  const row = rowOf(data, projectId);
  const counts = {};
  for (const episodeId of Object.values(row.items)) counts[episodeId] = (counts[episodeId] || 0) + 1;
  const episodes = row.episodes
    .slice()
    .sort((a, b) => (a.number - b.number) || (a.createdAt - b.createdAt))
    .map((episode) => ({ ...episode, count: counts[episode.id] || 0 }));
  const assigned = Object.keys(row.items).length;
  return { projectId: String(projectId || ''), episodes, assignments: { ...row.items }, assigned };
}

function create(projectId, input = {}) {
  const data = read();
  const row = rowOf(data, projectId);
  const number = Number(input.number) > 0 ? Number(input.number) : nextNumber(row);
  const name = String(input.name || `第${number}集`).trim().slice(0, 60) || `第${number}集`;
  if (row.episodes.some((episode) => episode.name === name)) throw new Error('已经有一集叫「' + name + '」了');
  const episode = { id: uid('ep-'), name, number: Number.isFinite(number) ? number : nextNumber(row), createdAt: Date.now() };
  row.episodes.push(episode);
  write(data);
  return { ...episode, count: 0 };
}

function rename(projectId, id, name) {
  const clean = String(name || '').trim().slice(0, 60);
  if (!clean) throw new Error('分集名称不能为空');
  const data = read();
  const row = rowOf(data, projectId);
  const episode = row.episodes.find((item) => item.id === id);
  if (!episode) throw new Error('分集不存在');
  if (row.episodes.some((item) => item.id !== id && item.name === clean)) throw new Error('已经有一集叫「' + clean + '」了');
  episode.name = clean;
  episode.number = numberFromName(clean, episode.number);
  write(data);
  return { ...episode };
}

function remove(projectId, id) {
  const data = read();
  const row = rowOf(data, projectId);
  const before = row.episodes.length;
  row.episodes = row.episodes.filter((item) => item.id !== id);
  if (row.episodes.length === before) throw new Error('分集不存在');
  let cleared = 0;
  for (const [rel, episodeId] of Object.entries(row.items)) {
    if (episodeId !== id) continue;
    delete row.items[rel];
    cleared += 1;
  }
  write(data);
  return { removed: id, cleared };
}

/** 把若干个成片放进某一集；episodeId 传空表示移出分集。 */
function assign(projectId, episodeId, rels) {
  const data = read();
  const row = rowOf(data, projectId);
  const list = (Array.isArray(rels) ? rels : [rels]).map((rel) => String(rel || '')).filter(Boolean);
  if (!list.length) return { assigned: 0, episodeId: episodeId || '' };
  if (episodeId) {
    if (!row.episodes.some((item) => item.id === episodeId)) throw new Error('分集不存在');
    for (const rel of list) row.items[rel] = episodeId;
  } else {
    for (const rel of list) delete row.items[rel];
  }
  write(data);
  return { assigned: list.length, episodeId: episodeId || '', rels: list };
}

/** 成片改名后同步归属，避免分集里的记录挂在旧路径上。 */
function remap(projectId, pairs) {
  const data = read();
  const row = rowOf(data, projectId);
  let moved = 0;
  for (const pair of pairs || []) {
    const from = String(pair.from || '');
    const to = String(pair.to || '');
    if (!from || !to || from === to) continue;
    if (!row.items[from]) continue;
    row.items[to] = row.items[from];
    delete row.items[from];
    moved += 1;
  }
  if (moved) write(data);
  return moved;
}

module.exports = { storeFile, list, create, rename, remove, assign, remap, numberFromName };
