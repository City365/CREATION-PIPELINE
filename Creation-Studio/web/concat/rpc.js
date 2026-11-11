'use strict';
/**
 * 剪辑台的引擎客户端
 *
 * 它只会两件事：把原生调用 POST 到 /api/concat/rpc，把引擎广播的事件分发出去。
 * 它不认识 project.* / edit.* 的任何一条 —— 页面直接写引擎的方法名。
 * （这就是「前后端分离」在浏览器这一侧的样子：我们是 Concat 的客户端。）
 */
(function (root) {
  function create(options) {
    var opts = options || {};
    var base = opts.base || '/api/concat';
    var listeners = [];
    var events = [];
    var lastEngine = null;

    function postJson(url, body) {
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body || {}),
      }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (!response.ok || !data || data.ok === false) {
            var message = (data && (data.error || data.message)) || ('HTTP ' + response.status);
            var error = Error(message);
            error.status = response.status;
            throw error;
          }
          return data.data;
        });
      });
    }

    function getJson(url) {
      return fetch(url, { credentials: 'same-origin' }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (data) {
          if (!response.ok || !data || data.ok === false) {
            var message = (data && (data.error || data.message)) || ('HTTP ' + response.status);
            var error = Error(message);
            error.status = response.status;
            throw error;
          }
          return data.data;
        });
      });
    }

    function emit(incoming) {
      (incoming || []).forEach(function (event) {
        events.push(event);
        if (events.length > 200) events.splice(0, events.length - 200);
        listeners.forEach(function (fn) {
          try { fn(event); } catch (error) { console.error('[concat] event listener', error); }
        });
      });
    }

    function toError(row) {
      var detail = (row && row.error) || {};
      var error = Error(detail.message || '引擎拒绝了这条命令');
      error.code = detail.code || null;
      error.engine = detail.engine || null;
      return error;
    }

    return {
      base: base,

      engine: function () { return getJson(base + '/engine'); },
      start: function () { return postJson(base + '/engine/start', {}); },
      stop: function () { return postJson(base + '/engine/stop', {}); },

      /** 一条原生调用；结果就是引擎给的结果，错误带引擎的错误码。 */
      call: function (method, params, lane) {
        var row = { id: method, method: method, params: params || {} };
        if (lane === 'frame') row.lane = 'frame';
        return postJson(base + '/rpc', { calls: [row] }).then(function (data) {
          lastEngine = data.engine || lastEngine;
          emit(data.events);
          var reply = (data.replies || [])[0];
          if (!reply) throw Error('引擎没有回包（' + method + '）');
          if (!reply.ok) throw toError(reply);
          return reply.result;
        });
      },

      /** 多条一起发（编辑时把一次拖动压成一条 batch，就是一个撤销步）。 */
      callMany: function (rows) {
        return postJson(base + '/rpc', { calls: rows || [] }).then(function (data) {
          lastEngine = data.engine || lastEngine;
          emit(data.events);
          return (data.replies || []).map(function (reply, index) {
            return { id: reply.id !== undefined ? reply.id : (rows[index] && rows[index].id), ok: reply.ok, result: reply.result, error: reply.error };
          });
        });
      },

      /** 只取事件，不发命令（轮询进度用）。 */
      drain: function () {
        return postJson(base + '/rpc', { calls: [], drain: true }).then(function (data) {
          lastEngine = data.engine || lastEngine;
          emit(data.events);
          return data.events || [];
        });
      },

      /** 预览帧的直连地址；带 t 让 <img> 天然按帧缓存。 */
      frameUrl: function (projectPath, time, width, height) {
        var url = base + '/frame?path=' + encodeURIComponent(projectPath) + '&t=' + encodeURIComponent(Number(time).toFixed(4));
        if (width) url += '&w=' + Math.round(width);
        if (height) url += '&h=' + Math.round(height);
        return url;
      },

      onEvent: function (fn) {
        listeners.push(fn);
        return function () {
          var index = listeners.indexOf(fn);
          if (index >= 0) listeners.splice(index, 1);
        };
      },

      engineState: function () { return lastEngine; },
      recentEvents: function () { return events.slice(); },
    };
  }

  var API = { create: create };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.CONCAT_RPC = API;
}(typeof window !== 'undefined' ? window : globalThis));
