'use strict';

/**
 * 剪映草稿的目标计算：把「选中的片段 / 某一集 / 全部集」换算成要生成的草稿清单。
 * 只做纯计算，不接触文件系统，方便单测。
 */

function shotIndexOf(item) {
  const text = String((item && (item.shotLabel || item.outputLabel)) || (item && item.name) || '');
  const match = /(\d+)/.exec(text);
  return match ? Number(match[1]) : 9999;
}

function sortClips(items) {
  return items
    .slice()
    .sort((a, b) => (shotIndexOf(a) - shotIndexOf(b)) || (a.mtime - b.mtime));
}

function planTargets(body, { projectName, data, mediaItems }) {
  const input = body && typeof body === 'object' ? body : {};
  const episodes = Array.isArray(data && data.episodes) ? data.episodes : [];
  const assignments = (data && data.assignments) || {};
  const media = Array.isArray(mediaItems) ? mediaItems : [];
  const byRel = new Map(media.map((item) => [item.rel, item]));
  const itemsOf = (episodeId) => sortClips(Object.entries(assignments)
    .filter(([, id]) => id === episodeId)
    .map(([rel]) => byRel.get(rel))
    .filter(Boolean));

  const rels = (Array.isArray(input.rels) ? input.rels : []).map((rel) => String(rel)).filter(Boolean);
  if (rels.length) {
    const items = sortClips(rels.map((rel) => byRel.get(rel)).filter(Boolean));
    if (!items.length) return { error: '选中的成片不在当前项目的视频库里' };
    const label = items.length === 1 ? String(items[0].name || '').replace(/\.[^.]+$/, '') : `选中 ${items.length} 条`;
    return { targets: [{ name: String(input.name || `${projectName}-${label}`), items, episodeId: '' }] };
  }

  if (input.all) {
    const targets = [];
    for (const episode of episodes) {
      const items = itemsOf(episode.id);
      if (items.length) targets.push({ name: `${projectName}-${episode.name}`, items, episodeId: episode.id });
    }
    return targets.length ? { targets } : { error: '还没有分集里有成片，先把片段拖进分集' };
  }

  if (input.episodeId) {
    const episode = episodes.find((item) => item.id === input.episodeId);
    if (!episode) return { error: '分集不存在' };
    const items = itemsOf(episode.id);
    if (!items.length) return { error: `${episode.name} 还没有成片，先把片段拖进这一集` };
    return { targets: [{ name: `${projectName}-${episode.name}`, items, episodeId: episode.id }] };
  }

  if (!media.length) return { error: '媒体库里还没有成片' };
  return { targets: [{ name: projectName, items: sortClips(media), episodeId: '' }] };
}

module.exports = { shotIndexOf, sortClips, planTargets };
