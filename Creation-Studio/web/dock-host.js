/* 原生窗口停靠（M1 伪嵌入）· 前端
 *
 * 浏览器没法把 Slint 原生窗口塞进 DOM，但可以让它稳稳地坐在页面预留区域正上方：
 *   预留区 getBoundingClientRect → 加上窗口在屏幕上的原点 → 报给后端 → SetWindowPos
 * 看起来就是页面里长出来的一块剪辑台，实际是原生窗口，操作、快捷键、拖时间线全是真的。
 *
 * 谁的坐标： screenX/screenY 给的是**视口**左上角在屏幕上的位置（CSS 像素），
 * 所以屏幕坐标 = (screenX + rect.left, screenY + rect.top)，再乘 devicePixelRatio
 * 换成物理像素。乘换算在后端做（dock() 里），这边只报 CSS 像素 + scale。
 *
 * 用法：
 *   var handle = DockHost.attach({ stage: el, onState: fn, project: 'D:\\proj' });
 *   handle.open()      // 没开就开一个 Concat，然后停靠
 *   handle.restore()   // 还原成普通窗口
 *   handle.destroy()   // 拆掉监听（离开页面时）
 */
(function () {
  'use strict';

  var SYNC_MS = 800;      // 兜底轮询：窗口被系统挪了、页面滚了都能拉回来
  var MIN_W = 200;
  var MIN_H = 120;

  function rectOf(el) {
    var r = el.getBoundingClientRect();
    var sx = typeof window.screenX === 'number' ? window.screenX : (window.screenLeft || 0);
    var sy = typeof window.screenY === 'number' ? window.screenY : (window.screenTop || 0);
    var scale = window.devicePixelRatio || 1;
    return {
      x: Math.round(sx + r.left),
      y: Math.round(sy + r.top),
      w: Math.round(r.width),
      h: Math.round(r.height),
      scale: scale
    };
  }

  function same(a, b) {
    if (!a || !b) return false;
    return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 &&
      Math.abs(a.w - b.w) < 2 && Math.abs(a.h - b.h) < 2;
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (!res.ok || payload.ok === false) {
          var detail = payload && payload.data && payload.data.error;
          throw new Error(payload.error || detail || ('HTTP ' + res.status));
        }
        return payload.data;
      });
    });
  }

  function get(url) {
    return fetch(url, { headers: { 'Accept': 'application/json' } }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (payload) {
        if (!res.ok || payload.ok === false) throw new Error(payload.error || ('HTTP ' + res.status));
        return payload.data;
      });
    });
  }

  function attach(options) {
    var stage = options.stage;
    var onState = typeof options.onState === 'function' ? options.onState : function () {};
    var project = options.project || '';

    var state = { phase: 'idle', last: null, desired: null, error: '', window: null, pending: false };
    var observer = null;
    var timer = 0;
    var destroyed = false;
    var inflight = 0;

    function emit() {
      try { onState(publicState()); } catch (error) { /* 页面自己的事 */ }
    }

    function publicState() {
      return {
        phase: state.phase,
        error: state.error,
        desired: state.desired,
        window: state.window,
        docked: state.phase === 'docked'
      };
    }

    function setPhase(phase, error) {
      state.phase = phase;
      state.error = error || '';
      emit();
    }

    /** 把当前预留区报给后端；坐标没变就不打请求。 */
    function sync(force) {
      if (destroyed || !stage) return Promise.resolve();
      if (state.phase !== 'docked' && state.phase !== 'docking') return Promise.resolve();
      var box = rectOf(stage);
      if (box.w < MIN_W || box.h < MIN_H) {
        // 区域被折叠/隐藏时不硬挪，等它回来
        return Promise.resolve();
      }
      if (!force && same(box, state.last)) return Promise.resolve();
      if (inflight > 2) return Promise.resolve();   // 拖得再猛也不排队
      inflight += 1;
      state.last = box;
      return post('/api/local/dock/dock', { x: box.x, y: box.y, w: box.w, h: box.h, scale: box.scale, borderless: true, topmost: true })
        .then(function (data) {
          state.window = data;
          state.desired = box;
          if (state.phase === 'docking') setPhase('docked');
        })
        .catch(function (error) {
          state.error = error.message;
          if (/还没开/.test(error.message)) { state.phase = 'idle'; state.last = null; }
          emit();
        })
        .then(function () { inflight -= 1; });
    }

    function open() {
      setPhase('docking');
      return get('/api/local/dock')
        .then(function (info) {
          state.window = info;
          if (info.running) return info;
          return post('/api/local/dock/launch', { project: project });
        })
        .then(function () { return sync(true); })
        .then(function () {
          if (state.phase === 'docking') setPhase('docked');
          return publicState();
        })
        .catch(function (error) { setPhase('error', error.message); return publicState(); });
    }

    function restore() {
      return post('/api/local/dock/restore')
        .then(function (data) { state.window = data; state.last = null; setPhase('idle'); return publicState(); })
        .catch(function (error) { setPhase('error', error.message); return publicState(); })
        .then(function (result) {
          // 还原之后也把状态刷一遍：用户点「还原」说明他要正常拖这个窗口了
          return refresh().then(function () { return result; });
        });
    }

    function refresh() {
      return get('/api/local/dock')
        .then(function (info) {
          state.window = info;
          if (!info.running && state.phase === 'docked') { state.phase = 'idle'; state.last = null; }
          emit();
          return info;
        })
        .catch(function (error) { state.error = error.message; emit(); return null; });
    }

    function destroy() {
      destroyed = true;
      if (observer) { try { observer.disconnect(); } catch (error) { /* ignore */ } observer = null; }
      if (timer) { window.clearInterval(timer); timer = 0; }
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    }

    function onViewportChange() {
      if (state.phase === 'docked' || state.phase === 'docking') sync(false);
    }

    if (window.ResizeObserver) {
      observer = new ResizeObserver(onViewportChange);
      try { observer.observe(stage); } catch (error) { /* ignore */ }
    }
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    timer = window.setInterval(function () {
      if (state.phase === 'docked' || state.phase === 'docking') sync(false);
    }, SYNC_MS);

    refresh();
    emit();

    return { open: open, restore: restore, refresh: refresh, sync: function () { return sync(true); }, state: publicState, destroy: destroy };
  }

  window.DockHost = { attach: attach, rectOf: rectOf };
})();
