'use strict';
/**
 * 时间线的放置数学（纯函数，不碰 DOM、不碰网络）
 *
 * 为什么必须在前端做：实测引擎对「同一轨道上把片段移到与别人重叠的位置」是**静默 no-op**
 * （不报错、不改变状态）。所以吸附、避让、落到空位、拖边夹紧，全得由这里算好，
 * 再发一条引擎听得懂的 moveClips / trimClip。引擎那边的 placing 逻辑在 UI 侧（placing.rs），
 * 不在引擎里 —— 这就是为什么这一层不能省。
 *
 * 约定：
 *   - 时间单位是秒（浮点），落点一律按帧对齐到 frame = 1/fps。
 *   - 片段自己占 [start, start+duration)，首尾相接不算重叠。
 *   - 最短时长 1/60 秒，跟引擎的 trim 下限一致。
 */
(function (root) {
  var MIN_DURATION = 1 / 60;

  function clamp(value, low, high) {
    if (!Number.isFinite(value)) return low;
    return Math.min(high, Math.max(low, value));
  }

  function frameSec(fps) {
    var rate = Number(fps) > 0 ? Number(fps) : 24;
    return 1 / rate;
  }

  /** 落到最近的帧上；round 决定是四舍五入还是向下取整。 */
  function quantize(time, frame, mode) {
    var step = frame > 0 ? frame : 1 / 24;
    if (!Number.isFinite(time)) return 0;
    var scaled = time / step;
    var n = mode === 'floor' ? Math.floor(scaled + 1e-6) : Math.round(scaled);
    return Math.max(0, n * step);
  }

  /** 增量（可正可负）的落帧：位置用 quantize，位移得保住符号。 */
  function quantizeDelta(delta, frame) {
    var value = Number(delta) || 0;
    var snapped = quantize(Math.abs(value), frame);
    return value < 0 ? -snapped : snapped;
  }

  function clipEnd(clip) {
    return Number(clip.start || 0) + Number(clip.duration || 0);
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart < bEnd - 1e-6 && bStart < aEnd - 1e-6;
  }

  /** 只算同一条轨道上、不在 ignore 里的片段。 */
  function neighbours(clips, trackId, ignore) {
    var skip = ignore || {};
    return (clips || []).filter(function (clip) {
      return clip.trackId === trackId && !skip[clip.id];
    }).sort(function (a, b) { return Number(a.start) - Number(b.start); });
  }

  function collides(list, start, duration, frame) {
    var end = start + Math.max(MIN_DURATION, duration);
    for (var i = 0; i < list.length; i++) {
      var clip = list[i];
      if (overlaps(start, end, Number(clip.start), clipEnd(clip))) return true;
    }
    return false;
  }

  /**
   * 在这个轨道上为 [start, start+duration) 找一个不与别人重叠的位置：
   * 先试原位置，再试被挡住那两个片段的边缘，最后顺着排到该轨道的末尾。
   */
  function freeStart(list, start, duration, frame) {
    var from = quantize(Math.max(0, start), frame);
    var length = Math.max(MIN_DURATION, duration);
    if (!collides(list, from, length, frame)) return from;

    var probes = [];
    for (var i = 0; i < list.length; i++) {
      var clip = list[i];
      probes.push(quantize(Number(clip.start) - length, frame));
      probes.push(quantize(clipEnd(clip), frame));
    }
    probes = probes.filter(function (value) { return value >= 0; });
    probes.sort(function (a, b) { return Math.abs(a - from) - Math.abs(b - from); });
    for (var k = 0; k < probes.length; k++) {
      if (!collides(list, probes[k], length, frame)) return probes[k];
    }
    // 都挤满了：排到最后
    var tail = 0;
    for (var j = 0; j < list.length; j++) tail = Math.max(tail, clipEnd(list[j]));
    return quantize(tail, frame);
  }

  /** 候选吸附点：每一段的头尾 + 播放头 + 0。 */
  function edgeCandidates(clips, playhead, ignore) {
    var skip = ignore || {};
    var out = [0];
    (clips || []).forEach(function (clip) {
      if (skip[clip.id]) return;
      out.push(Number(clip.start) || 0);
      out.push(clipEnd(clip));
    });
    if (Number.isFinite(playhead)) out.push(playhead);
    return out;
  }

  /**
   * 把一次拖动的落点吸到最近的边上。
   * 头尾都参与：哪一头吸得更近就用哪一头，返回修正后的 start。
   */
  function snapStart(start, duration, candidates, threshold, frame) {
    var best = null;
    var limit = Math.max(0, Number(threshold) || 0);
    for (var i = 0; i < candidates.length; i++) {
      var point = candidates[i];
      // 头对着边
      var deltaHead = point - start;
      if (Math.abs(deltaHead) <= limit) {
        var headStart = quantize(Math.max(0, point), frame);
        if (!best || Math.abs(deltaHead) < Math.abs(best.delta)) best = { start: headStart, delta: deltaHead };
      }
      // 尾对着边
      var deltaTail = point - (start + duration);
      if (Math.abs(deltaTail) <= limit) {
        var tailStart = quantize(Math.max(0, point - duration), frame);
        if (!best || Math.abs(deltaTail) < Math.abs(best.delta)) best = { start: tailStart, delta: deltaTail };
      }
    }
    if (!best) return { start: quantize(Math.max(0, start), frame), snapped: false };
    return { start: best.start, snapped: true };
  }

  /**
   * 一次拖动的完整解算：给原位置和一个时间/轨道增量，算出每一段该发的目标位置。
   * moving: [{id, start, duration, trackId}]（拖动开始时抓的快照）
   * 返回 [{clipId, start, trackId}]，可以直接塞进 moveClips。
   */
  function resolveMove(options) {
    var opts = options || {};
    var clips = opts.clips || [];
    var moving = opts.moving || [];
    var frame = frameSec(opts.fps);
    var threshold = Number(opts.snapThreshold) || 0;
    var targetTrack = opts.trackId || (moving[0] && moving[0].trackId);
    if (!moving.length) return [];

    var anchor = moving[0];
    var rawStart = Math.max(0, Number(anchor.start) + (Number(opts.deltaTime) || 0));

    var ignore = {};
    moving.forEach(function (clip) { ignore[clip.id] = true; });

    if (threshold > 0) {
      var snapped = snapStart(rawStart, Number(anchor.duration) || 0, edgeCandidates(clips, opts.playhead, ignore), threshold, frame);
      rawStart = snapped.start;
    }
    rawStart = quantize(rawStart, frame);

    var list = neighbours(clips, targetTrack, ignore);
    // 多选时整体平移：先给锚点找位置，再让其它片段跟着同样的偏移
    var placed = freeStart(list, rawStart, Number(anchor.duration) || 0, frame);
    var shift = placed - Number(anchor.start);

    return moving.map(function (clip) {
      var start = quantize(Math.max(0, Number(clip.start) + shift), frame);
      return { clipId: clip.id, start: start, trackId: targetTrack };
    });
  }

  /**
   * 拖边的夹紧：算出真正能发的 delta（秒）。
   * edge: 'start' | 'end'。ripple 时不看邻居，只看最短时长。
   */
  function clampTrim(options) {
    var opts = options || {};
    var clip = opts.clip || {};
    var edge = opts.edge === 'start' ? 'start' : 'end';
    var delta = Number(opts.delta) || 0;
    var frame = frameSec(opts.fps);
    var list = neighbours(opts.clips || [], clip.trackId, opts.ignore || (function () { var m = {}; m[clip.id] = true; return m; })());

    var start = Number(clip.start) || 0;
    var duration = Number(clip.duration) || 0;
    var previousEnd = 0;
    var nextStart = Infinity;
    for (var i = 0; i < list.length; i++) {
      var other = list[i];
      var otherStart = Number(other.start) || 0;
      if (otherStart + Number(other.duration) <= start + 1e-6) previousEnd = Math.max(previousEnd, clipEnd(other));
      if (otherStart >= start + duration - 1e-6) nextStart = Math.min(nextStart, otherStart);
    }

    var snapped = quantizeDelta(delta, frame);
    if (edge === 'start') {
      // 头往右 = 变短；往左 = 变长（有源可补的前提下由引擎判断）
      var maxRight = duration - MIN_DURATION;
      var maxLeft = -(start - previousEnd);
      if (opts.ripple) { maxLeft = -start; }
      return clamp(snapped, maxLeft, maxRight);
    }
    var maxGrow = opts.ripple ? Infinity : Math.max(0, nextStart - (start + duration));
    var maxShrink = -(duration - MIN_DURATION);
    return clamp(snapped, maxShrink, maxGrow === Infinity ? 1e9 : maxGrow);
  }

  /** 轨道的显示名：V1/V2/A1… */
  function trackLabel(track) {
    var kind = String((track && track.kind) || 'video');
    var prefix = kind === 'audio' ? 'A' : (kind === 'text' ? 'T' : 'V');
    var index = Number(track && track.index);
    return prefix + (Number.isFinite(index) ? index + 1 : '?');
  }

  /** 时间码 mm:ss:ff */
  function timecode(seconds, fps) {
    var rate = Number(fps) > 0 ? Math.round(Number(fps)) : 24;
    var total = Math.max(0, Number(seconds) || 0);
    var frames = Math.round(total * rate);
    var f = frames % rate;
    var rest = Math.floor(frames / rate);
    var s = rest % 60;
    var m = Math.floor(rest / 60);
    function pad(value, size) { return String(value).padStart(size || 2, '0'); }
    return pad(m, 2) + ':' + pad(s) + ':' + pad(f);
  }

  /** 时长的人话：1.5s / 1:05 */
  function shortDuration(seconds, fps) {
    var value = Math.max(0, Number(seconds) || 0);
    if (value < 60) return value.toFixed(2).replace(/0$/, '') + 's';
    return timecode(value, fps);
  }

  var API = {
    MIN_DURATION: MIN_DURATION,
    clamp: clamp,
    frameSec: frameSec,
    quantize: quantize,
    quantizeDelta: quantizeDelta,
    clipEnd: clipEnd,
    overlaps: overlaps,
    neighbours: neighbours,
    collides: collides,
    freeStart: freeStart,
    edgeCandidates: edgeCandidates,
    snapStart: snapStart,
    resolveMove: resolveMove,
    clampTrim: clampTrim,
    trackLabel: trackLabel,
    timecode: timecode,
    shortDuration: shortDuration,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.CONCAT_PLACING = API;
}(typeof window !== 'undefined' ? window : globalThis));
