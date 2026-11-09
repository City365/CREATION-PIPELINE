/* ==========================================================================
   shell-nav.js — 左侧二级菜单
   依据 risk-agent-ui-skill：一级图标轨由 index.html 静态给出，二级菜单按当前
   模块动态生成；没有子项的模块整列隐藏。
   零侵入：不改 app.js，靠点击代理 + MutationObserver 同步。

   视频创作台的二级菜单只到「厂商」这一层（Seedance / MiniMax-H3 / ViDu /
   Muse / Grok-Video / 其他），点一下切到该厂商的默认工作流；具体模型与分辨率、
   时长等参数由页面底部的「视频模型」区域决定。
   ========================================================================== */
(function shellNav() {
  const rail = document.getElementById('nav');
  const subnav = document.getElementById('subnav');
  if (!rail || !subnav) return;

  const g = (sel) => document.querySelector(sel);

  /* ---------------- 视频厂商分组 ---------------- */

  const VIDEO_VENDORS = [
    { key: 'seedance', title: 'Seedance', sub: '豆包 / 火山', match: (w) => /doubao/i.test(w.id) },
    { key: 'minimax', title: 'MiniMax-H3', sub: 'MiniMax', match: (w) => /minimax_h3|^rh:/i.test(w.id) || /H3/.test(w.label || '') },
    { key: 'vidu', title: 'ViDu', sub: '生数科技', match: () => false },
    { key: 'muse', title: 'Muse', sub: 'Meta', match: () => false },
    { key: 'grok', title: 'Grok-Video', sub: 'Grok', match: () => false },
  ];

  function workflows() {
    try {
      return (typeof state !== 'undefined' && Array.isArray(state.workflows)) ? state.workflows : [];
    } catch (error) {
      return [];
    }
  }

  function currentWorkflowId() {
    try {
      return state.studio.workflowId || '';
    } catch (error) {
      return '';
    }
  }

  // 切到指定工作流：优先走页面暴露的切换钩子（不受下拉选项过滤影响），
  // 拿不到时退回「先切渠道再切模型」的模拟点击
  function switchWorkflow(id) {
    const list = workflows();
    const target = list.find((w) => w.id === id);
    if (!target) return;
    if (currentWorkflowId() === id) return;
    if (typeof window.__studioSwitchWorkflow === 'function') {
      window.__studioSwitchWorkflow(id);
      if (typeof window.syncHash === 'function') {
        try { window.syncHash('studio', { vendor: vendorKeyOf(target) }); } catch (error) { /* 忽略 */ }
      }
      return;
    }
    const channelSel = g('#channel-select');
    const modelSel = g('#p-model');
    if (channelSel && channelSel.value !== (target.channelId || '')) {
      channelSel.value = target.channelId || '';
      channelSel.dispatchEvent(new Event('change', { bubbles: true }));
      setTimeout(() => {
        const next = g('#p-model');
        if (!next) return;
        next.value = id;
        next.dispatchEvent(new Event('change', { bubbles: true }));
      }, 90);
      return;
    }
    if (modelSel) {
      modelSel.value = id;
      modelSel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  // 每个厂商一条：点击切到该厂商默认工作流
  function vendorGroups() {
    const list = workflows();
    const used = new Set();
    const groups = VIDEO_VENDORS.map((vendor) => {
      const items = list.filter((w) => !used.has(w.id) && vendor.match(w));
      items.forEach((w) => used.add(w.id));
      return {
        key: vendor.key,
        title: vendor.title,
        sub: vendor.sub,
        items: items.length
          ? [{ label: vendor.title, sub: vendor.sub, value: items[0].id, ids: items.map((w) => w.id) }]
          : [],
        empty: !items.length,
      };
    });
    const rest = list.filter((w) => !used.has(w.id));
    groups.push({
      key: 'other',
      title: '其他',
      sub: '动作迁移 / Gemini 等',
      items: rest.length ? [{ label: '其他', sub: '动作迁移 / Gemini 等', value: rest[0].id, ids: rest.map((w) => w.id) }] : [],
      empty: !rest.length,
    });
    return groups;
  }

  /* ---------------- 静态菜单 ---------------- */

  const MENUS = {
    image: {
      title: '图像',
      groups: () => [{
        key: 'image',
        title: '',
        sub: '',
        items: [
          { label: '图像编辑', tab: 'edit', sel: "[data-img-tab='edit']" },
          { label: '图像生成', tab: 'generate', sel: "[data-img-tab='generate']" },
          { label: '图像反推', tab: 'reverse', sel: "[data-img-tab='reverse']" },
          { label: '场景建模', tab: 'scene', sel: "[data-img-tab='scene']" },
        ],
      }],
    },
    tasks: {
      title: '任务',
      groups: () => [{
        key: 'tasks',
        title: '',
        sub: '',
        items: [
          { label: '创建任务', sel: "[data-task-tab='create']", on: "[data-task-tab='create'][aria-selected='true']" },
          { label: '任务管理', sel: "[data-task-tab='manage']", on: "[data-task-tab='manage'][aria-selected='true']" },
          { label: '任务调度', sel: "[data-task-tab='schedule']", on: "[data-task-tab='schedule'][aria-selected='true']" },
          { label: '任务监控', sel: "[data-task-tab='monitor']", on: "[data-task-tab='monitor'][aria-selected='true']" },
          { label: '日志', sel: "[data-task-tab='logs']", on: "[data-task-tab='logs'][aria-selected='true']" },
        ],
      }],
    },
    studio: {
      title: '模型',
      groups: () => vendorGroups(),
    },
    assets: {
      title: '素材',
      groups: () => [{
        key: 'assets',
        title: '',
        sub: '',
        items: [
          { label: '人物素材', tab: '素材/人物', kind: 'dir' },
          { label: '场景素材', tab: '素材/场景', kind: 'dir' },
          { label: '道具素材', tab: '素材/道具', kind: 'dir' },
          { label: '分镜脚本', tab: 'shots', kind: 'shots' },
        ],
      }],
    },
  };

  /* ---------------- 渲染 ---------------- */

  function currentImageTab() {
    try {
      return state.image.tab || 'generate';
    } catch (error) {
      return 'generate';
    }
  }

  function itemActive(route, item) {
    if (route === 'studio') {
      if (Array.isArray(item.ids)) return item.ids.includes(currentWorkflowId());
      return item.value === currentWorkflowId();
    }
    if (route === 'image' && item.tab) return currentImageTab() === item.tab;
    if (route === 'media' && item.tab !== undefined) {
      let current = '';
      try { current = state.mediaTask ? 'task:' + state.mediaTask : ''; } catch (error) { /* 未初始化 */ }
      return current === item.tab;
    }
    if (route === 'assets' && item.tab) {
      let view = { kind: 'overview' };
      try { view = state.assetView || view; } catch (error) { /* 未初始化 */ }
      if (item.tab === 'shots') return view.kind === 'shot-root' || view.kind === 'shot-task' || view.kind === 'shot';
      return view.kind === 'dir' && String(view.rel || '').startsWith(item.tab);
    }
    return item.on ? Boolean(document.querySelector(item.on)) : false;
  }

  function currentRoute() {
    const active = rail.querySelector('.wmd-maintab.is-active');
    return active ? active.dataset.route : '';
  }

  let signature = '';

  function build() {
    const route = currentRoute();
    const menu = MENUS[route];
    if (!menu) {
      subnav.hidden = true;
      subnav.innerHTML = '';
      signature = 'none';
      return;
    }
    const groups = menu.groups();
    const html = [`<div class="wmd-subnav-title">${menu.title}</div>`];

    groups.forEach((group) => {
      // 视频台：每个厂商一条，空的显示「暂无接入」
      if (route === 'studio') {
        if (group.empty) {
          html.push(
            `<div class="wmd-subnav-row is-muted"><span class="wmd-subnav-name">${group.title}</span>` +
            `<small>${group.sub}</small><em>暂无接入</em></div>`
          );
          return;
        }
        const item = group.items[0];
        const on = itemActive(route, item);
        html.push(
          `<button type="button" class="wmd-subnav-item wmd-subnav-vendor${on ? ' is-on' : ''}"` +
          ` data-shell-nav="${item.value}" data-shell-route="studio" aria-current="${on ? 'page' : 'false'}">` +
          `<span class="wmd-subnav-name">${group.title}</span><small>${group.sub}</small></button>`
        );
        return;
      }

      if (!group.items.length) return;
      if (group.title) {
        html.push(`<div class="wmd-subnav-group">${group.title}${group.sub ? `<small>${group.sub}</small>` : ''}</div>`);
      }
      group.items.forEach((item) => {
        const on = itemActive(route, item);
        const value = item.value || item.tab || item.sel;
        html.push(
          `<button type="button" class="wmd-subnav-item${on ? ' is-on' : ''}"` +
          ` data-shell-nav="${value}" data-shell-route="${route}"` +
          ` title="${(item.label || '').replace(/"/g, '')}"` +
          ` aria-current="${on ? 'page' : 'false'}">${item.label}</button>`
        );
      });
    });

    subnav.hidden = false;
    subnav.innerHTML = html.join('');
    signature = route + '|' + currentWorkflowId() + '|' +
      groups.map((gr) => (gr.empty ? 'x' : gr.items.map((i) => (itemActive(route, i) ? '1' : '0')).join(''))).join(',');
  }

  function sync() {
    const route = currentRoute();
    if (!MENUS[route]) {
      if (signature !== 'none') build();
      return;
    }
    build();
  }

  subnav.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-shell-nav]');
    if (!btn) return;
    if (btn.dataset.shellRoute === 'studio') {
      switchWorkflow(btn.dataset.shellNav);
      setTimeout(sync, 160);
      return;
    }
    if (btn.dataset.shellRoute === 'image' && typeof window.__imageSwitchTab === 'function') {
      window.__imageSwitchTab(btn.dataset.shellNav);
      setTimeout(sync, 160);
      return;
    }
    if (btn.dataset.shellRoute === 'assets' && typeof window.__assetsOpen === 'function') {
      window.__assetsOpen(btn.dataset.shellNav);
      setTimeout(sync, 200);
      return;
    }
    if (btn.dataset.shellRoute === 'media' && typeof window.__mediaSetEpisode === 'function') {
      window.__mediaSetEpisode(btn.dataset.shellNav || '');
      setTimeout(sync, 260);
      return;
    }
    const target = document.querySelector(btn.dataset.shellNav);
    if (target) target.click();
    setTimeout(sync, 60);
  });

  rail.addEventListener('click', () => setTimeout(sync, 120));

  const view = document.getElementById('view');
  if (view) {
    new MutationObserver(() => sync()).observe(view, { childList: true, subtree: true });
  }

  sync();
  setTimeout(sync, 400);
  setTimeout(sync, 1200);
})();

/* ==========================================================================
   顶栏右侧：登录用户 + 日期时间
   左下角：服务状态点（点击启停，双击打开管理器）
   ========================================================================== */
(function topbarIdentity() {
  const nameEl = document.getElementById('wmd-user-name');
  const avatarEl = document.getElementById('wmd-user-avatar');
  const userBox = document.getElementById('wmd-user');
  const clockEl = document.getElementById('wmd-clock');

  function paintClock() {
    if (!clockEl) return;
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
    clockEl.innerHTML =
      `<span>${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}</span>` +
      `<small>${pad(now.getHours())}:${pad(now.getMinutes())} ${week}</small>`;
  }
  paintClock();
  setInterval(paintClock, 15000);

  fetch('/api/auth/me', { credentials: 'same-origin' })
    .then((r) => r.json())
    .then((res) => {
      const user = (res && res.data && res.data.user) || null;
      if (!user) return;
      const label = user.name || user.username || '用户';
      if (nameEl) nameEl.textContent = label;
      if (avatarEl) avatarEl.textContent = label.slice(0, 1).toUpperCase();
      if (userBox) {
        userBox.title = [label, user.role, user.tenantId].filter(Boolean).join(' · ');
      }
    })
    .catch(() => { /* 未登录时保持默认 */ });

  // 管理器圆点：双击直接打开管理器工作台
  const managerDot = document.querySelector('.wmd-svc-item[data-svc="manager"]');
  if (managerDot) {
    managerDot.title = '点击启动/停止管理器 · 双击打开管理器';
    managerDot.addEventListener('dblclick', (event) => {
      event.preventDefault();
      const box = document.getElementById('svc-lights');
      let url = 'http://127.0.0.1:17778/';
      try {
        const detail = box && box.dataset.detail ? JSON.parse(box.dataset.detail) : {};
        if (detail.manager && detail.manager.url) url = detail.manager.url;
      } catch (error) { /* 用默认地址 */ }
      window.open(url, '_blank', 'noreferrer');
    });
  }

  const agentDot = document.querySelector('.wmd-svc-item[data-svc="agent"]');
  if (agentDot) agentDot.title = '智能体服务 · 点击启动/停止';

  /* ---- 用户菜单：用户资料 / 系统设置 / 关于系统 ---- */
  const userMenu = document.getElementById('wmd-user-menu');

  const ROLE_TEXT = { owner: '负责人', admin: '管理员', member: '成员' };
  const modalTimers = new Set();

  function infoRows(rows) {
    return `<dl class="wmd-info-list">${rows
      .map(([k, v]) => `<dt>${k}</dt><dd>${v == null || v === '' ? '—' : v}</dd>`)
      .join('')}</dl>`;
  }

  function openInfoPanel(title, inner) {
    if (typeof window.openModal !== 'function') return;
    const panel = window.openModal(
      `<div class="modal-head"><h2>${title}</h2>` +
      `<span class="grow"></span>` +
      `<button type="button" class="wmd-btn wmd-btn-sm wmd-btn-ghost" data-close="1">关闭</button></div>` +
      `<div class="modal-body"><div class="wmd-info-pane">${inner}</div></div>`
    );
    if (panel) panel.classList.add('modal-settings');
  }

  function openUserPanel(kind) {
    if (kind === 'settings') {
      if (typeof window.openSettings === 'function') window.openSettings('text');
      return;
    }
    if (kind === 'profile') {
      openInfoPanel('用户资料', '<p class="wmd-info-loading">读取中…</p>');
      fetch('/api/auth/me', { credentials: 'same-origin' })
        .then((r) => r.json())
        .then((res) => {
          const u = (res && res.data && res.data.user) || {};
          const space = (res && res.data && res.data.space) || null;
          const inner = infoRows([
            ['用户名', u.username],
            ['角色', ROLE_TEXT[u.role] || u.role],
            ['租户', space && space.tenantName ? space.tenantName : u.tenantId],
            ['用户 ID', u.id],
            ['注册时间', u.createdAt ? new Date(u.createdAt).toLocaleString('zh-CN') : ''],
            ['项目数', space && space.projects != null ? String(space.projects) : ''],
          ]);
          openInfoPanel('用户资料', inner);
        })
        .catch(() => openInfoPanel('用户资料', '<p class="wmd-info-loading">读取失败，请稍后重试。</p>'));
      return;
    }
    if (kind === 'about') {
      openInfoPanel('关于系统', '<p class="wmd-info-loading">读取中…</p>');
      Promise.all([
        fetch('/api/health', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => null),
        fetch('/api/web-version', { credentials: 'same-origin' }).then((r) => r.json()).catch(() => null),
      ]).then(([health, version]) => {
        const up = health && health.data && health.data.uptime;
        const uptimeText = typeof up === 'number'
          ? `${Math.floor(up / 3600)} 小时 ${Math.floor((up % 3600) / 60)} 分`
          : '';
        const ver = (version && version.data && version.data.version) || '';
        const inner = infoRows([
          ['产品', 'WENYUN.M-DESKTOP · CREATIVE DESK'],
          ['版本', (document.querySelector('.wmd-version') || {}).textContent || ''],
          ['前端指纹', ver],
          ['控制器', 'http://127.0.0.1:17821'],
          ['智能体', 'http://127.0.0.1:17820'],
          ['管理器', 'http://127.0.0.1:17778'],
          ['运行时长', uptimeText],
          ['当前用户', (document.getElementById('wmd-user-name') || {}).textContent || ''],
        ]);
        openInfoPanel('关于系统', inner);
      });
    }
  }

  if (userBox && userMenu) {
    // 顶栏是独立层叠上下文，菜单挂到 body 上才不会被画布工具条盖住
    document.body.appendChild(userMenu);

    const placeMenu = () => {
      const rect = userBox.getBoundingClientRect();
      userMenu.style.top = Math.round(rect.bottom + 6) + 'px';
      userMenu.style.right = Math.round(window.innerWidth - rect.right) + 'px';
      userMenu.style.left = 'auto';
    };

    const setOpen = (open) => {
      if (open) placeMenu();
      userMenu.hidden = !open;
      userBox.setAttribute('aria-expanded', String(open));
    };
    userBox.addEventListener('click', (event) => {
      if (event.target.closest('.wmd-user-menu')) return;
      event.stopPropagation();
      setOpen(userMenu.hidden);
    });
    userBox.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setOpen(userMenu.hidden);
      } else if (event.key === 'Escape') {
        setOpen(false);
      }
    });
    document.addEventListener('click', (event) => {
      if (userMenu.hidden) return;
      if (userMenu.contains(event.target) || userBox.contains(event.target)) return;
      setOpen(false);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !userMenu.hidden) setOpen(false);
    });
    userMenu.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-user-act]');
      if (!btn) return;
      setOpen(false);
      openUserPanel(btn.dataset.userAct);
    });
  }
})();
