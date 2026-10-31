// Device layer: resilient CDP attachment to the Doubao chat page + menu/account/composer probes.
import { CdpClient, DEFAULT_PORT, listTargets, pickChatTarget } from './cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const src = (fnBody) => '(() => {' + String.fromCharCode(10) + fnBody.join(String.fromCharCode(10)) + String.fromCharCode(10) + '})()';

export const PAGE = {
  // current account name + account rows (call with the avatar menu open)
  accounts: src([
    '  const menu = document.querySelector("[data-testid=chat_header_menu]");',
    '  const wrap = document.querySelector("[data-radix-popper-content-wrapper]");',
    '  const rows = menu ? [...menu.querySelectorAll("[data-testid=avatar_menu_account_row]")] : [];',
    '  const headerBtns = wrap ? [...wrap.querySelectorAll("button")].map((b) => (b.innerText || "").trim()).filter(Boolean) : [];',
    '  const quotaLine = menu ? ((menu.innerText || "").split(String.fromCharCode(10)).find((t) => t.indexOf("额度") >= 0) || "") : "";',
    '  const footBtn = document.querySelector("[data-sidebar-footer-account-menu] button");',
    '  const sidebarCurrent = footBtn ? ((footBtn.innerText || "").split(String.fromCharCode(10)).map((s) => s.trim()).filter(Boolean)[0] || "") : null;',
    '  return {',
    '    menuOpen: !!menu,',
    '    current: sidebarCurrent || (headerBtns.length ? headerBtns[0].split(String.fromCharCode(10))[0] : null),',
    '    quotaLine,',
    '    accounts: rows.map((r, i) => {',
    '      const lines = (r.innerText || "").split(String.fromCharCode(10)).map((s) => s.trim()).filter(Boolean);',
    '      return { index: i, name: lines[0] || "", plan: lines[1] || "", selected: /mode-?select|checked|active/.test(String(r.className)) };',
    '    }),',
    '  };',
  ]),

  menus: src([
    '  const inList = (e) => !!e.closest("[data-testid=chat_list_wrapper]");',
    '  const nav = [...document.querySelectorAll("[data-testid=chat_route_layout_leftside_nav] [data-testid], [data-testid=flow_chat_sidebar] [data-testid]")]',
    '    .filter((e) => e.getClientRects().length && !inList(e))',
    '    .map((e) => ({ testid: e.getAttribute("data-testid"), label: (e.innerText || "").split(String.fromCharCode(10)).filter(Boolean)[0] || "" }))',
    '    .filter((e) => e.label);',
    '  const seen = new Set();',
    '  const left = nav.filter((e) => { const k = e.testid; if (seen.has(k)) return false; seen.add(k); return true; });',
    '  const convs = [...document.querySelectorAll("[data-testid=conversation-list-v2-item]")].map((el) => {',
    '    const leaf = [...el.querySelectorAll("span")].find((s) => s.children.length === 0 && (s.textContent || "").trim());',
    '    return { id: el.getAttribute("data-conversation-id") || null, title: leaf ? leaf.textContent.trim() : "" };',
    '  }).filter((c) => c.title);',
    '  const composer = document.querySelector("[data-testid=chat_input]");',
    '  const buttons = composer ? [...composer.querySelectorAll("button")].filter((b) => b.getClientRects().length).map((b) => ({',
    '    testid: b.getAttribute("data-testid"),',
    '    text: (b.innerText || "").trim().slice(0, 20),',
    '    label: b.getAttribute("aria-label") || "",',
    '    disabled: b.disabled === true || b.getAttribute("data-disabled") === "true",',
    '  })) : [];',
    '  const model = document.querySelector("[data-testid=chat_input_action_model]");',
    '  const mode = document.querySelector("[data-testid=chat_input_action_mode]");',
    '  const skills = [...document.querySelectorAll("[data-testid=guidance-skill-bar] [data-testid]")].map((e) => ({ testid: e.getAttribute("data-testid"), label: (e.innerText || "").trim().slice(0, 12) }));',
    '  const footer = [...document.querySelectorAll("[data-testid=sidebar_bottom] [data-testid], [data-testid=sidebar_footer_setting_entry]")].map((e) => ({ testid: e.getAttribute("data-testid"), label: e.getAttribute("aria-label") || (e.innerText || "").trim().slice(0, 12) }));',
    '  return {',
    '    left: { nav: left, conversations: convs },',
    '    bottom: {',
    '      model: model ? (model.innerText || "").trim().slice(0, 24) : "",',
    '      mode: mode ? (mode.innerText || "").trim().slice(0, 24) : "",',
    '      buttons: buttons,',
    '      skills: skills,',
    '      footer: footer,',
    '    },',
    '  };',
  ]),

  rect: (selector, index) => [
    '(() => {',
    '  const els = [...document.querySelectorAll(' + JSON.stringify(selector) + ')];',
    '  const el = els[' + Number(index || 0) + '];',
    '  if (!el) return null;',
    '  el.scrollIntoView({ block: "center", inline: "center" });',
    '  const r = el.getBoundingClientRect();',
    '  if (!r.width && !r.height) return null;',
    '  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };',
    '})()',
  ].join(String.fromCharCode(10)),
};

export class Device {
  constructor(options = {}) {
    this.port = options.port || DEFAULT_PORT;
    this.client = null;
    this.target = null;
    this.log = options.log || (() => {});
    // 每个界面动作之间留的间隔，避免操作过快触发风控。
    this.paceMs = Number(options.paceMs) || 1000;
    this.actionTimeoutMs = Number(options.actionTimeoutMs) || 60000;
  }

  async pace(extraMs = 0) {
    const wait = Math.max(this.paceMs, extraMs);
    if (wait > 0) await sleep(wait);
  }

  async withTimeout(promise, label, timeoutMs) {
    let timer;
    const limit = timeoutMs || this.actionTimeoutMs;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' timeout ' + limit + 'ms')), limit); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async attach() {
    const targets = await listTargets(this.port);
    const target = pickChatTarget(targets);
    if (!target) throw new Error('doubao chat target not found');
    this.client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await this.client.send('Runtime.enable');
    this.target = target;
    return this.client;
  }

  async ensure() {
    if (this.client && !this.client.closed) return this.client;
    return this.attach();
  }

  // Reconnects once when the page is reloaded (account switch replaces the web contents).
  async evaluate(expression, { retry = 1 } = {}) {
    try {
      await this.ensure();
      return await this.client.evaluate(expression);
    } catch (err) {
      this.client = null;
      if (retry > 0) {
        await sleep(600);
        return this.evaluate(expression, { retry: retry - 1 });
      }
      throw err;
    }
  }

  async waitFor(expression, { timeoutMs = 30000, intervalMs = 400 } = {}) {
    const started = Date.now();
    let last = null;
    while (Date.now() - started < timeoutMs) {
      try {
        const value = await this.evaluate(expression);
        if (value) return value;
        last = value;
      } catch (err) {
        last = err.message;
      }
      await sleep(intervalMs);
    }
    throw new Error('waitFor timeout after ' + timeoutMs + 'ms (last=' + JSON.stringify(last) + ')');
  }

  async click(selector, index = 0) {
    const rect = await this.evaluate(PAGE.rect(selector, index));
    if (!rect) throw new Error('element not found: ' + selector + '[' + index + ']');
    await this.clickPoint(rect);
    await this.pace();
    return rect;
  }

  async clickPoint(rect) {
    const base = { x: rect.x, y: rect.y, button: 'left', clickCount: 1 };
    const client = await this.ensure();
    await client.send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseMoved' }, base));
    await client.send('Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed' }, base));
    await sleep(50);
    await client.send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased' }, base));
  }

  async pressEscape() {
    const client = await this.ensure();
    const base = { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 };
    await client.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown' }, base));
    await client.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyUp' }, base));
  }

  async openAccountMenu(attempts = 3) {
    let lastError = null;
    for (let i = 0; i < attempts; i++) {
      const open = await this.evaluate('(() => !!document.querySelector("[data-testid=chat_header_menu]"))()').catch(() => null);
      if (open) return true;
      try {
        await this.click('[data-testid="chat_header_avatar_button"]');
        await this.waitFor('(() => !!document.querySelector("[data-testid=chat_header_menu]"))()', { timeoutMs: 6000 });
        return true;
      } catch (err) {
        lastError = err;
        this.client = null;
        await sleep(1500);
      }
    }
    throw new Error('account menu did not open: ' + (lastError && lastError.message));
  }

  async closeAccountMenu() {
    const open = await this.evaluate('(() => !!document.querySelector("[data-testid=chat_header_menu]"))()').catch(() => false);
    if (!open) return true;
    await this.pressEscape();
    await this.waitFor('(() => !document.querySelector("[data-testid=chat_header_menu]"))()', { timeoutMs: 5000 }).catch(() => null);
    return true;
  }

  async listAccounts(attempts = 3) {
    let lastError = null;
    for (let i = 0; i < attempts; i++) {
      try {
        await this.openAccountMenu();
        const data = await this.evaluate(PAGE.accounts);
        await this.closeAccountMenu();
        return data;
      } catch (err) {
        lastError = err;
        this.client = null;
        await sleep(1200);
      }
    }
    throw lastError || new Error('listAccounts failed');
  }

  async currentAccount() {
    const data = await this.listAccounts();
    return data.current;
  }

  // Switch account by name fragment or index. The page reloads, so reconnect afterwards.
  async switchAccount(selector) {
    const before = await this.listAccounts();
    const wanted = typeof selector === 'number'
      ? before.accounts[selector]
      : before.accounts.find((a) => a.name.indexOf(String(selector)) >= 0 || (a.plan || '').indexOf(String(selector)) >= 0);
    if (!wanted) throw new Error('account not found: ' + selector);
    if (before.current && wanted.name && before.current.indexOf(wanted.name) >= 0) {
      return { ok: true, switched: false, account: wanted.name, previous: before.current };
    }
    await this.openAccountMenu();
    // The click can tear down the page mid-request; that is expected.
    await this.click('[data-testid="avatar_menu_account_row"]', wanted.index).catch((err) => {
      this.log('switch click ended early: ' + (err && err.message));
    });
    this.client = null;
    const started = Date.now();
    let current = null;
    while (Date.now() - started < 90000) {
      await sleep(1200);
      try {
        const ready = await this.evaluate('(() => { const ed = document.querySelector("div.ProseMirror[contenteditable=true]"); const list = document.querySelectorAll("[data-testid=conversation-list-v2-item]").length; return !!ed && document.readyState === "complete" && list > 0; })()', { retry: 0 });
        if (!ready) continue;
        await sleep(1200);
        const data = await this.listAccounts();
        current = data.current;
        if (current && wanted.name && current.indexOf(wanted.name) >= 0) {
          return { ok: true, switched: true, account: wanted.name, previous: before.current, elapsedMs: Date.now() - started };
        }
      } catch {
        this.client = null;
      }
    }
    throw new Error('switchAccount timeout, current=' + current + ', wanted=' + wanted.name);
  }

  async menus() {
    return this.evaluate(PAGE.menus);
  }
}
