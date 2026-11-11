/* 智能剪辑（一级菜单）· 对话即流程
 *
 * 这一页只做一件事：用户说人话 → 智能体出剪辑单 → 调执行引擎 → 回成片地址。
 * 二级菜单的两个引擎是「执行后端」：剪映出草稿、Concat 直接渲染 mp4。
 *
 * 与后端的接线（全部是现成接口，没有新增）：
 *   POST /api/agent/chat                 一次对话，SSE 回流
 *   GET  /api/agent/mcp/servers          引擎真实状态（应用包 mcp_servers 的探活）
 *   POST /api/agent/runs/<id>/cancel     停止
 * 事件类型：delta / replace / tool_call / tool_result / process / media / artifact / done
 */
(function () {
  'use strict';

  var ENGINES = [
    { id: 'jianying', name: '剪映草稿', short: '剪映', server: 'jianying', note: '转场 / 字幕 / BGM 写进草稿，成片在剪映里导出' },
    { id: 'concat', name: 'Concat 引擎', short: 'Concat', server: 'concat', note: '本地渲染 mp4，带预览帧和导出进度' }
  ];

  var S = {
    engine: 'jianying',
    sid: '',
    messages: [],
    running: false,
    draft: '',
    created: 0,
    sessionReady: false,
    status: null,
    statusAt: 0
  };

  var root = null;
  var deps = {};
  var controller = null;
  var runId = '';
  var rafId = 0;

  /* ------------------------------------------------------------------ 工具 */
  var $ = function (sel, scope) { return (scope || root || document).querySelector(sel); };
  var $$ = function (sel, scope) { return Array.prototype.slice.call((scope || root || document).querySelectorAll(sel)); };

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function storeKey() { return 'wmd.smartcut.' + (deps.projectId || 'default'); }

  function load() {
    try {
      var raw = window.localStorage.getItem(storeKey());
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return;
      if (data.engine && engineOf(data.engine)) S.engine = data.engine;
      if (typeof data.sid === 'string') S.sid = data.sid;
      if (Array.isArray(data.messages)) S.messages = data.messages.slice(-40);
    } catch (error) { /* 坏数据就当没有 */ }
  }

  function save() {
    try {
      window.localStorage.setItem(storeKey(), JSON.stringify({
        engine: S.engine,
        sid: S.sid,
        messages: S.messages.slice(-40).map(function (m) {
          return { id: m.id, role: m.role, text: m.text, time: m.time, tools: m.tools, media: m.media, done: m.done };
        })
      }));
    } catch (error) { /* 配额满了就只活在本轮 */ }
  }

  function engineOf(id) {
    for (var i = 0; i < ENGINES.length; i++) if (ENGINES[i].id === id) return ENGINES[i];
    return null;
  }

  function newSid() {
    return 'sc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  }

  /**
   * 后端只认已存在会话（不存在的 session_id 会回「会话不存在，请重新创建」）。
   * 所以第一次发言前先把这一页的消息流登记成会话，之后每轮再更新一次，
   * 这样刷新页面 / 换路由回来还能接着聊。
   */
  function saveSession(history) {
    var first = S.messages.filter(function (m) { return m.role === 'user'; })[0];
    var title = (first && first.text ? first.text : '智能剪辑').replace(/\s+/g, ' ').slice(0, 40);
    return fetch('/api/agent/sessions/' + encodeURIComponent(S.sid), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Project-Id': deps.projectId || '' },
      body: JSON.stringify({
        id: S.sid,
        title: title,
        created: S.created || Date.now(),
        updated: Date.now(),
        messages: (history || []).map(function (m) {
          return { id: m.id, role: m.role, text: m.text || '', time: m.time || Date.now() };
        })
      })
    }).then(function (res) {
      if (!res.ok) throw new Error('会话保存失败');
      S.sessionReady = true;
      return res;
    });
  }

  function fmtDur(sec) {
    var value = Number(sec) || 0;
    var m = Math.floor(value / 60);
    var s = value - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + (Math.round(s * 10) / 10).toFixed(1);
  }

  function fmtBytes(n) {
    var value = Number(n) || 0;
    if (value >= 1073741824) return (value / 1073741824).toFixed(1) + ' GB';
    if (value >= 1048576) return (value / 1048576).toFixed(1) + ' MB';
    if (value >= 1024) return Math.round(value / 1024) + ' KB';
    return value ? value + ' B' : '';
  }

  function markdown(text) {
    if (typeof deps.markdown === 'function') {
      try { return deps.markdown(text); } catch (error) { /* 退化成纯文本 */ }
    }
    return '<p>' + esc(text).replace(/\n/g, '<br>') + '</p>';
  }

  /* ------------------------------------------------------------------ 视图 */
  function statusText() {
    var engine = engineOf(S.engine);
    var item = S.status && S.status.items ? S.status.items.filter(function (x) { return x.name === engine.server; })[0] : null;
    if (!S.status) return { cls: '', text: '引擎状态读取中' };
    if (!item) return { cls: 'bad', text: '引擎未挂：应用包 mcp_servers 里没有 ' + engine.server };
    if (item.ok) return { cls: 'ok', text: engine.name + ' 可用 · ' + item.tools + ' 个工具' };
    return { cls: 'bad', text: engine.name + ' 连不上 · ' + (item.error || '未启动') };
  }

  function shell() {
    var engine = engineOf(S.engine);
    var st = statusText();
    return '' +
      '<div class="sc-top">' +
        '<span class="sc-title">剪辑台</span>' +
        '<span class="sc-sub">' + esc(deps.projectName || '当前项目') + '</span>' +
        '<span class="sc-grow"></span>' +
        '<span class="sc-dock-state" id="sc-dock-state">未开启</span>' +
        '<button type="button" class="sc-ghost" data-dock="open" id="sc-dock-open">打开剪辑台</button>' +
        '<button type="button" class="sc-ghost" data-dock="restore">还原成窗口</button>' +
        '<button type="button" class="sc-ghost" data-dock="toggle" id="sc-dock-toggle" title="收起 / 展开右侧对话">对话</button>' +
      '</div>' +
      '<div class="sc-body">' +
        '<div class="sc-canvas" id="sc-dock">' + dockEmpty() + '</div>' +
        '<aside class="sc-rail" id="sc-rail">' +
          '<div class="sc-rail-top">' +
            '<div class="sc-eng">' +
              ENGINES.map(function (item) {
                return '<button type="button" data-eng="' + item.id + '"' + (item.id === S.engine ? ' class="is-on"' : '') + '>' +
                  '<i></i>' + esc(item.short || item.name) + '</button>';
              }).join('') +
            '</div>' +
            '<span class="sc-grow"></span>' +
            '<button type="button" class="sc-ghost" data-act="reset">新会话</button>' +
          '</div>' +
          '<div class="sc-status" id="sc-status">' +
            '<span class="sc-dot ' + st.cls + '"></span><b>' + esc(st.text) + '</b>' +
            '<span class="sc-sep">·</span><span>产出：' + (S.engine === 'jianying' ? '剪映草稿目录' : 'mp4 地址') + '</span>' +
          '</div>' +
          '<div class="sc-thread" id="sc-thread"><div class="sc-inner" id="sc-inner"></div></div>' +
          '<div class="sc-composer-area">' +
            '<div class="sc-composer">' +
              '<textarea id="sc-input" rows="2" placeholder="说说这一版怎么剪，比如：第 01 集按台词卡点剪一版，竖屏，字幕贴底"></textarea>' +
              '<div class="sc-cbar">' +
                '<button type="button" class="sc-cbtn is-on" data-act="perm">工作区权限</button>' +
                '<span class="sc-grow"></span>' +
                '<span class="sc-stat" id="sc-stat">' + (S.running ? '正在跑' : '空闲') + '</span>' +
                '<button type="button" class="sc-send" id="sc-send">发送</button>' +
              '</div>' +
            '</div>' +
            '<div class="sc-hint"><kbd>Enter</kbd> 发送，<kbd>Shift</kbd>+<kbd>Enter</kbd> 换行。</div>' +
          '</div>' +
        '</aside>' +
      '</div>';
  }

  /**
   * 剪辑台面板：一块留给原生 Concat 窗口的空格子。
  /**
   * 剪辑台画布：整块左边都留给原生 Concat 窗口。
   * 停靠后原生窗口正好盖住它——页面看上去就是剪辑台本身（预览 / 时间线 / 字幕都在里面直接改），
   * 右边那条窄栏才是智能体对话。空着的时候给一句人话和一个按钮，不做花哨占位。
   */
  function dockEmpty() {
    return '' +
      '<div class="sc-dock-stage" id="sc-dock-stage">' +
        '<div class="sc-dock-empty">' +
          '<span class="sc-dock-ico">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<rect x="2.5" y="4.5" width="19" height="15" rx="2"/><path d="M2.5 9.5h19"/><path d="M8 19v-5h8v5"/>' +
            '</svg>' +
          '</span>' +
          '<b>剪辑台还没打开</b>' +
          '<span>这一整块就是剪辑台。点开之后 Concat 原生窗口落进来，预览、时间线、字幕都在这里直接改；右边那条线留给智能体，说一句怎么剪。</span>' +
          '<button type="button" class="sc-dbtn is-primary" data-dock="open">打开剪辑台</button>' +
        '</div>' +
      '</div>';
  }

  function dumpDockState(state) {
    var label = $('#sc-dock-state');
    var canvas = $('#sc-dock');
    var stage = $('#sc-dock-stage');
    var toggle = $('#sc-dock-toggle');
    if (label) {
      var text = { idle: '未开启', docking: '正在停靠', docked: '已停靠 · 可直接操作', error: '没停上' }[state.phase] || '未开启';
      label.textContent = state.error ? text + '：' + state.error : text;
      label.className = 'sc-dock-state' + (state.phase === 'docked' ? ' is-on' : '') + (state.phase === 'error' ? ' is-bad' : '');
    }
    if (canvas) {
      if (state.phase === 'docked') canvas.classList.add('is-docked');
      else canvas.classList.remove('is-docked');
    }
    if (stage) {
      var box = state.desired || (state.window && state.window.rect);
      var win = state.window || {};
      stage.title = box
        ? '坐标 ' + Math.round(box.x) + ',' + Math.round(box.y) + ' · ' + Math.round(box.w) + '×' + Math.round(box.h) +
          (win.rect ? ' → ' + win.rect.x + ',' + win.rect.y + ' · ' + win.rect.w + '×' + win.rect.h : '')
        : '';
    }
    var rail = $('#sc-rail');
    if (toggle) toggle.title = rail && rail.classList.contains('is-closed') ? '展开右侧对话' : '收起右侧对话';
  }

  /** 右侧对话栏的收放：只动网页，不碰原生窗口。 */
  function dockOpenPane(show) {
    var rail = $('#sc-rail');
    if (!rail) return;
    if (show) rail.classList.remove('is-closed');
    else rail.classList.add('is-closed');
    if (S.dock && S.dock.sync) S.dock.sync();
  }

  function dockEnsure() {
    var stage = $('#sc-dock-stage');
    if (!stage || !window.DockHost) return null;
    if (S.dock) return S.dock;
    S.dock = window.DockHost.attach({
      stage: stage,
      project: (deps && deps.projectPath) || '',
      onState: dumpDockState
    });
    return S.dock;
  }
  /** 三个动作：开剪辑台、把原生窗口还原、收起右侧对话（镜头始终留给剪辑台）。 */
  function dockAct(mode) {
    var handle = dockEnsure();
    if (!handle) {
      if (deps.toast) deps.toast('这一页没有加载 dock-host.js，剪辑台挂不上去');
      return;
    }
    if (mode === 'toggle') {
      var rail = $('#sc-rail');
      dockOpenPane(Boolean(rail && rail.classList.contains('is-closed')));
      return;
    }
    if (mode === 'open') { dockOpenPane(true); handle.open(); return; }
    if (mode === 'restore') { handle.restore(); return; }
    if (mode === 'close') { dockOpenPane(false); return; }
  }

  function welcomeHtml() {
    var engine = engineOf(S.engine);
    var tips = S.engine === 'jianying' ? [
      ['按台词剪', '第 01 集按台词卡点剪一版，竖屏，字幕贴底', '剪映能写字幕轨和转场，成片在剪映里导出'],
      ['压到一分钟', '剪一版 60 秒以内，加叠化转场，音乐轻一点', '超时长会按比例压每镜'],
      ['换个味道', '换成钢琴 BGM，人声段压低，加雪花特效', '曲库搜歌，ducking 写进草稿'],
      ['第二集', '第 02 集按镜号顺序剪，不要字幕', '缺素材的镜头会跳过']
    ] : [
      ['直接出片', '第 01 集整集渲染，自动识别字幕，竖屏', 'Concat 本地识别字幕，直接出 mp4'],
      ['剪成预告', '剪成 45 秒预告，前 3 秒给特写，加闪黑', '超时长按比例压，交付带进度'],
      ['换编码', 'HEVC 渲染一版，60 帧', '编码和帧率由引擎参数决定'],
      ['第二集', '第 02 集按台词卡点剪，去掉音乐', '缺素材的镜头会跳过']
    ];
    return '<div class="sc-welcome">' +
      '<div class="sc-wico">✂</div>' +
      '<div class="sc-eyebrow">智能剪辑 · ' + esc(engine.name) + '</div>' +
      '<h2>说一句怎么剪<br>剪辑单、执行、成片地址都在这儿</h2>' +
      '<p>智能体读媒体库里的分镜和成片，把你这句人话翻成剪辑单，交给执行引擎跑，跑完把片子地址贴回来。</p>' +
      '<div class="sc-tips">' + tips.map(function (t) {
        return '<button type="button" class="sc-tip" data-tip="' + esc(t[1]) + '"><b>' + esc(t[0]) + '</b>' +
          '<span>' + esc(t[1]) + '</span><em>' + esc(t[2]) + '</em></button>';
      }).join('') + '</div>' +
      '<div class="sc-wnote">这一页不做时间线拖拽 —— 要精细调整就打开草稿在剪映里改，或者直接再说一句。</div>' +
      '</div>';
  }

  function toolName(name) {
    var text = String(name || '');
    if (text.indexOf('mcp__') === 0) {
      var rest = text.slice(5).split('__');
      return rest.length > 1 ? rest[0] + ' · ' + rest[1] : rest[0];
    }
    return text;
  }

  function toolArg(args) {
    if (!args || typeof args !== 'object') return '';
    var keys = Object.keys(args).slice(0, 3);
    return keys.map(function (key) {
      var value = args[key];
      if (value && typeof value === 'object') value = JSON.stringify(value);
      return key + '=' + String(value).slice(0, 28);
    }).join(' ');
  }

  function traceHtml(msg) {
    var tools = msg.tools || [];
    if (!tools.length) return '';
    var failed = tools.filter(function (t) { return t.state === 'err'; }).length;
    var running = tools.filter(function (t) { return t.state === 'run'; }).length;
    var state = running ? '进行中' : (failed ? '失败 ' + failed : '全部成功');
    return '<details class="sc-trace"' + (msg.done ? '' : ' open') + '>' +
      '<summary><b>执行轨迹</b><span>' + tools.length + ' 步</span>' +
      '<span class="sc-trace-state">' + esc(state) + '</span></summary>' +
      '<div class="sc-steps">' + tools.map(function (tool, index) {
        return '<div class="sc-step' + (tool.state === 'err' ? ' is-err' : '') + '">' +
          '<span class="n">' + (index + 1) + '</span>' +
          '<span class="t">' + esc(toolName(tool.name)) + '</span>' +
          '<span class="a">' + esc(toolArg(tool.args)) + '</span>' +
          '<span class="s">' + (tool.state === 'run' ? '…' : (tool.state === 'err' ? 'err' : 'ok')) + '</span>' +
          '</div>';
      }).join('') + '</div></details>';
  }

  /* 剪辑单：助手正文里 ```json 且带 clips 数组的那一块 */
  function extractPlan(text) {
    var reg = /```json\s*([\s\S]*?)```/g;
    var match;
    while ((match = reg.exec(String(text || '')))) {
      try {
        var obj = JSON.parse(match[1]);
        if (obj && Array.isArray(obj.clips) && obj.clips.length) return obj;
      } catch (error) { /* 不是剪辑单就跳过 */ }
    }
    return null;
  }

  function planHtml(plan, msg) {
    var clips = plan.clips || [];
    var total = Number(plan.total) || clips.reduce(function (a, c) { return a + (Number(c.duration) || 0); }, 0);
    var facts = [
      ['镜头', clips.length + ' 条'],
      ['时长', fmtDur(total)],
      ['画幅', plan.canvas ? (plan.canvas.ratio || '') + (plan.canvas.fps ? ' · ' + plan.canvas.fps + 'fps' : '') : (plan.ratio || '—')],
      ['字幕', plan.subtitles ? (plan.subtitles.count || plan.subtitles.mode || '有') : '不加'],
      ['转场', plan.transition || '硬切'],
      ['引擎', plan.engine === 'concat' ? 'Concat 引擎' : '剪映草稿']
    ];
    var rows = clips.slice(0, 40).map(function (clip, index) {
      return '<tr><td class="n">' + esc(clip.shot != null ? clip.shot : index + 1) + '</td>' +
        '<td>' + esc(clip.line || clip.path || '—') + '</td>' +
        '<td class="d">' + (Number(clip.duration) ? (Math.round(Number(clip.duration) * 10) / 10) + 's' : '—') + '</td></tr>';
    }).join('');
    return '<div class="sc-plan" data-plan="' + esc(msg.id) + '">' +
      '<div class="sc-plan-head"><b>' + esc(plan.episode || plan.name || '剪辑单') + '</b><span class="sc-tag">待执行</span></div>' +
      '<div class="sc-facts">' + facts.map(function (f) {
        return '<span class="sc-fact">' + esc(f[0]) + ' <b>' + esc(f[1]) + '</b></span>';
      }).join('') + '</div>' +
      (rows ? '<details class="sc-shots"><summary><span>镜头表 · ' + clips.length + ' 条</span><span>展开</span></summary>' +
        '<table class="sc-shot-tbl"><thead><tr><th>镜号</th><th>台词 / 素材</th><th style="text-align:right">时长</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></details>' : '') +
      '<div class="sc-plan-foot">' +
        '<button type="button" class="sc-btn is-primary" data-act="run-plan">按这份执行</button>' +
        '<button type="button" class="sc-btn" data-act="tweak">再说一句改</button>' +
      '</div></div>';
  }

  function mediaHtml(files) {
    if (!files || !files.length) return '';
    return '<div class="sc-media">' + files.map(function (file) {
      var url = file.url || (file.path ? '/api/file?path=' + encodeURIComponent(file.path) : '');
      var kind = file.kind || '';
      var isVideo = kind === 'video' || /\.(mp4|webm|mov|m4v)$/i.test(file.path || '');
      var isImage = kind === 'image' || /\.(png|jpe?g|webp|gif)$/i.test(file.path || '');
      var isAudio = kind === 'audio' || /\.(mp3|wav|m4a|ogg)$/i.test(file.path || '');
      var preview = '';
      if (url && isVideo) preview = '<video src="' + esc(url) + '" controls preload="metadata"></video>';
      else if (url && isImage) preview = '<img src="' + esc(url) + '" alt="' + esc(file.name || '') + '" loading="lazy">';
      return '<div class="sc-card">' + preview +
        '<div class="sc-card-body">' +
          '<span class="sc-card-name">' + esc(file.name || '产物') + '</span>' +
          '<span class="sc-card-meta">' + (isVideo ? '视频' : isImage ? '图片' : isAudio ? '音频' : '文件') +
            (file.bytes ? ' · ' + esc(fmtBytes(file.bytes)) : '') + '</span>' +
          (file.path ? '<span class="sc-card-path">' + esc(file.path) + '</span>' : '') +
        '</div>' +
        (url ? '<div class="sc-card-foot"><a class="sc-btn" href="' + esc(url) + '" target="_blank" rel="noreferrer">打开</a>' +
          '<button type="button" class="sc-btn" data-copy="' + esc(url) + '">复制地址</button></div>' : '') +
        '</div>';
    }).join('') + '</div>';
  }

  function msgHtml(msg) {
    if (msg.role === 'user') {
      return '<div class="sc-msg is-user"><div class="sc-bubble">' + esc(msg.text) + '</div></div>';
    }
    var plan = extractPlan(msg.text);
    var text = msg.text ? markdown(msg.text.replace(/```json[\s\S]*?```/g, '').trim()) : '';
    var waiting = !msg.text && !(msg.tools || []).length && !msg.done;
    return '<div class="sc-msg" data-mid="' + esc(msg.id) + '">' +
      (text ? '<div class="sc-text" data-text="' + esc(msg.id) + '">' + text + '</div>'
        : (waiting ? '<div class="sc-typing">读媒体库<i></i><i></i><i></i></div>' : '')) +
      traceHtml(msg) +
      (plan ? planHtml(plan, msg) : '') +
      mediaHtml(msg.media) +
      '</div>';
  }

  function renderThread() {
    var box = $('#sc-inner');
    if (!box) return;
    box.innerHTML = S.messages.length ? S.messages.map(msgHtml).join('') : welcomeHtml();
    scrollDown();
  }

  function scrollDown() {
    var thread = $('#sc-thread');
    if (thread) thread.scrollTop = thread.scrollHeight;
  }

  function renderStatus() {
    var box = $('#sc-status');
    if (!box) return;
    var st = statusText();
    var engine = engineOf(S.engine);
    box.innerHTML = '<span class="sc-dot ' + st.cls + '"></span><b>' + esc(st.text) + '</b>' +
      '<span class="sc-sep">·</span><span>产出：' + (S.engine === 'jianying' ? '剪映草稿目录' : 'mp4 地址') + '</span>' +
      '<span class="sc-sep">·</span><span>素材：媒体库 · 成片</span>';
  }

  function renderSendState() {
    var button = $('#sc-send');
    if (!button) return;
    button.textContent = S.running ? '停止' : '发送';
    button.classList.toggle('is-stop', S.running);
    var stat = $('#sc-stat');
    if (stat) stat.textContent = S.running ? '正在跑' : (S.messages.length ? '就绪' : '空闲');
  }

  /* ------------------------------------------------------------------ 引擎 */
  function setEngine(id, fromUser) {
    if (!engineOf(id) || id === S.engine) return;
    S.engine = id;
    $$('.sc-eng button').forEach(function (btn) {
      btn.classList.toggle('is-on', btn.getAttribute('data-eng') === id);
    });
    var sub = $('.sc-sub');
    if (sub) sub.textContent = engineOf(id).note;
    renderStatus();
    save();
    if (fromUser) {
      // 换引擎 = 换执行后端，旧剪辑单不再适用，明确说一句而不是偷偷清空
      if (deps.toast) deps.toast('已切到 ' + engineOf(id).name + '，剪辑单按旧引擎作废，重新说来一句');
    }
  }

  window.__editSetEngine = function (id) { setEngine(id, true); };

  function fetchStatus(force) {
    var now = Date.now();
    if (!force && S.status && now - S.statusAt < 15000) return Promise.resolve(S.status);
    return fetch('/api/agent/mcp/servers', { headers: { 'X-Project-Id': deps.projectId || '' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (data) { S.status = data; S.statusAt = Date.now(); renderStatus(); }
        return data;
      })
      .catch(function () { S.status = { items: [] }; S.statusAt = Date.now(); renderStatus(); return null; });
  }

  /* ------------------------------------------------------------------ 发送 */
  function autosize() {
    var input = $('#sc-input');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(180, Math.max(44, input.scrollHeight)) + 'px';
  }

  function send(text) {
    var value = String(text == null ? S.draft : text).trim();
    if (!value || S.running) return;
    if (!S.sid) S.sid = newSid();
    if (!S.created) S.created = Date.now();
    var input = $('#sc-input');
    if (input) { input.value = ''; input.style.height = 'auto'; }
    S.draft = '';

    var userMsg = { id: 'u' + Date.now().toString(36), role: 'user', text: value, time: Date.now() };
    var botMsg = {
      id: 'a' + Date.now().toString(36), role: 'assistant', text: '', time: Date.now(),
      tools: [], media: [], done: false
    };
    S.messages.push(userMsg, botMsg);
    S.running = true;
    renderThread();
    renderSendState();
    save();

    controller = new AbortController();
    runId = '';
    var requestId = 'sc-' + Math.random().toString(36).slice(2, 10);
    var history = S.messages.slice(0, S.messages.length - 2);

    saveSession(history).then(function () {
      return fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Project-Id': deps.projectId || '' },
      signal: controller.signal,
      body: JSON.stringify({
        client_request_id: requestId,
        session_id: S.sid,
        text: value,
        permission: 'workspace',
        web_search: false,
        project_name: deps.projectName || ''
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (error) {
          var detail = error && error.detail;
          throw new Error(typeof detail === 'string' ? detail : (detail && detail.message) || '智能体没接上');
        });
      }
      runId = res.headers.get('X-Agent-Run-Id') || '';
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      var lastSeq = 0;

      function pump() {
        return reader.read().then(function (part) {
          buffer += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
          var chunks = buffer.split('\n\n');
          buffer = chunks.pop() || '';
          chunks.forEach(function (chunk) {
            var line = chunk.split('\n').filter(function (x) { return x.indexOf('data: ') === 0; })[0];
            if (!line) return;
            var data;
            try { data = JSON.parse(line.slice(6)); } catch (error) { return; }
            if (typeof data.sequence === 'number') {
              if (data.sequence <= lastSeq) return;
              lastSeq = data.sequence;
            }
            applyEvent(botMsg, data);
          });
          if (part.done) return null;
          return pump();
        });
      }
      return pump();
    }).then(function () {
      finish(botMsg);
    });
    }).catch(function (error) {
      if (error && error.name === 'AbortError') {
        botMsg.text = botMsg.text || '（已停止）';
      } else {
        botMsg.text = (botMsg.text ? botMsg.text + '\n\n' : '') + '出错了：' + (error && error.message ? error.message : String(error));
      }
      finish(botMsg);
    });
  }

  function applyEvent(msg, data) {
    switch (data.type) {
      case 'delta':
        msg.text += data.text || '';
        patchText(msg);
        break;
      case 'replace':
        msg.text = data.text || '';
        patchText(msg);
        break;
      case 'tool_call':
        msg.tools.push({ id: data.tool_call_id || '', name: data.tool || '', args: data.arguments || {}, state: 'run' });
        patchTools(msg);
        break;
      case 'tool_result': {
        var id = data.tool_call_id;
        var found = null;
        for (var i = msg.tools.length - 1; i >= 0; i -= 1) {
          if (msg.tools[i].state === 'run' && (!id || msg.tools[i].id === id)) { found = msg.tools[i]; break; }
        }
        if (!found) { found = { id: id || '', name: data.tool || '', args: {}, state: 'run' }; msg.tools.push(found); }
        found.state = data.ok === false ? 'err' : 'ok';
        found.ms = data.duration_ms;
        patchTools(msg);
        break;
      }
      case 'media':
        (data.files || []).forEach(function (file) { msg.media.push(file); });
        patchAll(msg);
        break;
      case 'artifact':
        if (data.file) msg.media.push(data.file);
        patchAll(msg);
        break;
      case 'process':
        if (data.plan) msg.plan = data.plan;
        break;
      case 'done':
        msg.done = true;
        if (data.execution) msg.execution = data.execution;
        break;
      default:
        break;
    }
  }

  function patchText(msg) {
    if (rafId) return;
    rafId = window.requestAnimationFrame(function () {
      rafId = 0;
      var node = $('[data-text="' + msg.id + '"]');
      if (!node) { renderThread(); return; }
      node.innerHTML = markdown(msg.text.replace(/```json[\s\S]*?```/g, '').trim());
      scrollDown();
    });
  }

  function patchTools(msg) {
    var host = $('.sc-msg[data-mid="' + msg.id + '"]');
    if (!host) { renderThread(); return; }
    var old = host.querySelector('.sc-trace');
    var html = traceHtml(msg);
    if (old) old.outerHTML = html;
    else host.insertAdjacentHTML('beforeend', html);
    scrollDown();
  }

  function patchAll(msg) {
    var host = $('.sc-msg[data-mid="' + msg.id + '"]');
    if (!host) { renderThread(); return; }
    host.outerHTML = msgHtml(msg);
    scrollDown();
  }

  function finish(msg) {
    msg.done = true;
    msg.time = Date.now();
    S.running = false;
    controller = null;
    renderThread();
    renderSendState();
    save();
    if (!msg.text && !msg.tools.length) {
      var node = $('.sc-msg[data-mid="' + msg.id + '"] .sc-text');
      if (node) node.innerHTML = '<p>（这次没有拿到内容，再说一次试试）</p>';
    }
  }

  function stop() {
    if (!S.running) return;
    if (runId) {
      fetch('/api/agent/runs/' + encodeURIComponent(runId) + '/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Project-Id': deps.projectId || '' },
        body: '{}'
      }).catch(function () { /* 停不掉就让 abort 兜底 */ });
    }
    if (controller) controller.abort();
  }

  /* ------------------------------------------------------------------ 绑定 */
  function bind() {
    root.addEventListener('click', function (event) {
      var target = event.target.closest ? event.target.closest('[data-eng],[data-tip],[data-act],[data-copy],[data-dock]') : null;
      if (!target || !root.contains(target)) return;

      if (target.hasAttribute('data-dock')) { dockAct(target.getAttribute('data-dock')); return; }

      if (target.hasAttribute('data-eng')) { setEngine(target.getAttribute('data-eng'), true); return; }
      if (target.hasAttribute('data-copy')) {
        var url = target.getAttribute('data-copy');
        if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () {
          if (deps.toast) deps.toast('地址已复制');
        });
        return;
      }
      if (target.hasAttribute('data-tip')) { send(target.getAttribute('data-tip')); return; }

      var act = target.getAttribute('data-act');
      if (act === 'reset') {
        S.messages = [];
        S.sid = newSid();
        renderThread();
        save();
        return;
      }
      if (act === 'run-plan') {
        var card = target.closest('.sc-plan');
        var msgId = card ? card.getAttribute('data-plan') : '';
        var msg = S.messages.filter(function (m) { return m.id === msgId; })[0];
        var plan = msg ? extractPlan(msg.text) : null;
        if (!plan) return;
        target.disabled = true;
        target.textContent = '已交给智能体';
        send('按上面这份剪辑单执行：' + (plan.episode || plan.name || '') + '，' + plan.clips.length + ' 镜');
        return;
      }
      if (act === 'tweak') {
        var input = $('#sc-input');
        if (input) { input.focus(); input.placeholder = '比如：字幕加大到 12、压到 45 秒、换闪黑转场、不要音乐'; }
        return;
      }
      if (act === 'perm') {
        if (deps.toast) deps.toast('权限档位跟创作台设置同步，这里只显示当前值');
      }
    });

    root.addEventListener('keydown', function (event) {
      if (!event.target || event.target.id !== 'sc-input') return;
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send(event.target.value);
      }
    });

    root.addEventListener('input', function (event) {
      if (event.target && event.target.id === 'sc-input') { S.draft = event.target.value; autosize(); }
    });

    root.addEventListener('click', function (event) {
      if (event.target && event.target.id === 'sc-send') {
        if (S.running) stop(); else send($('#sc-input') ? $('#sc-input').value : S.draft);
      }
    }, true);
  }

  /* ------------------------------------------------------------------ 挂载 */
  function mount(host, options) {
    root = host;
    deps = options || {};
    if (S.dock && S.dock.destroy) { try { S.dock.destroy(); } catch (error) { /* ignore */ } }
    S.dock = null;
    load();
    if (!S.sid) S.sid = newSid();
    root.innerHTML = shell();
    bind();
    dockEnsure();
    renderThread();
    renderSendState();
    fetchStatus(true);
    var input = $('#sc-input');
    if (input) autosize();
  }

  window.SMARTCUT = {
    mount: mount,
    setEngine: function (id) { setEngine(id, true); },
    state: function () { return S; },
    engines: function () { return ENGINES.slice(); }
  };
})();
