'use strict';
// 豆包视频提取的检测记录：每次检测存一份快照，方便回溯「这个对话是什么时候、用哪个账号、解析出几条」。
// 直链有时效，所以记录里同时留了 UA/Referer/Cookie 快照，过期前可以直接从记录里重新下载。
const fs = require('node:fs');
const path = require('node:path');
const { readJSON, saveJSON } = require('./store');

const MAX_RECORDS = 120;

function createHistory(directory) {
  const file = path.join(directory, 'extract-history.json');
  let records = [];
  try {
    const data = readJSON(file, { records: [] });
    records = Array.isArray(data.records) ? data.records : [];
  } catch { records = []; }

  function persist() {
    saveJSON(file, { version: 1, records });
  }
  persist();

  function list() {
    return records.map((record) => ({
      id: record.id,
      at: record.at,
      url: record.url,
      accountId: record.accountId,
      accountName: record.accountName,
      title: record.title || '',
      conversationURL: record.conversationURL || record.url,
      summary: record.summary || { total: 0, unwatermarked: 0, downloadable: 0, failed: 0 },
      videoCount: (record.videos || []).length,
      downloads: (record.downloads || []).length,
      lastDownloadAt: (record.downloads || []).slice(-1)[0]?.at || '',
    }));
  }

  function get(id) {
    return records.find((record) => record.id === String(id || '')) || null;
  }

  function add(record) {
    records.unshift({ ...record, at: record.at || new Date().toISOString() });
    if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
    persist();
    return records[0];
  }

  function update(id, patch) {
    const record = get(id);
    if (!record) return null;
    Object.assign(record, typeof patch === 'function' ? patch(record) : patch);
    persist();
    return record;
  }

  function remove(id) {
    const index = records.findIndex((record) => record.id === String(id || ''));
    if (index < 0) return false;
    records.splice(index, 1);
    persist();
    return true;
  }

  function clear() {
    records = [];
    persist();
  }

  return { list, get, add, update, remove, clear, file };
}

module.exports = { createHistory };
