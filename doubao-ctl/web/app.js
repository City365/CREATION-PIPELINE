const el = (id) => document.getElementById(id);
const chat = el('chat');
const inputEl = el('input');
const statusDot = el('statusDot');
const statusText = el('statusText');
const convIdEl = el('convId');
const busyPill = el('busyPill');
const btnSend = el('btnSend');
const btnStop = el('btnStop');
const convList = el('convList');

let state = { busy: false, messages: [], partial: '', conversationId: null, lastResult: null };
let lastRenderKey = '';

async function api(path, options) {
  const res = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, options || {}));
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

function setStatus(ok, text) {
  statusDot.className = 'dot ' + (ok ? 'on' : 'err');
  statusText.textContent = text;
}

function renderMessages() {
  const items = state.messages.slice();
  if (state.busy && state.partial) {
    items.push({ role: 'assistant', text: state.partial, streaming: true });
  }
  const key = JSON.stringify([items.length, items.length ? items[items.length - 1].text.length : 0, state.busy, state.conversationId]);
  if (key === lastRenderKey) return;
  lastRenderKey = key;

  chat.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '还没有消息，发一条试试。';
    chat.appendChild(empty);
    return;
  }
  for (const m of items) {
    const row = document.createElement('div');
    row.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant') + (m.streaming ? ' streaming' : '');
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = m.role === 'user' ? '我' : '豆包';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = m.text;
    row.appendChild(who);
    row.appendChild(bubble);
    chat.appendChild(row);
  }
  chat.scrollTop = chat.scrollHeight;
}

function renderConvList(list) {
  convList.innerHTML = '';
  for (const c of list || []) {
    const node = document.createElement('div');
    node.className = 'conv' + (c.active ? ' active' : '');
    node.textContent = c.title;
    node.title = c.title + '  (' + c.id + ')';
    node.onclick = async () => {
      node.textContent = '(切换中) ' + c.title;
      try {
        await api('/api/open', { method: 'POST', body: JSON.stringify({ id: c.id }) });
        lastRenderKey = '';
        await tick();
        await loadConversations();
      } catch (err) {
        alert('切换失败: ' + err.message);
      }
    };
    convList.appendChild(node);
  }
}

async function loadConversations() {
  try {
    const data = await api('/api/conversations');
    renderConvList(data.conversations);
  } catch (err) {
    convList.innerHTML = '<div class="conv">会话列表读取失败</div>';
  }
}

async function tick() {
  try {
    const data = await api('/api/state');
    state = data;
    setStatus(!!data.cdpReady, data.cdpReady ? '已连接本地豆包' : (data.error || '未连接'));
    convIdEl.textContent = '会话 ' + (data.conversationId || '(新对话页)');
    busyPill.textContent = data.busy ? '生成中…' : '空闲';
    busyPill.className = 'pill' + (data.busy ? ' busy' : '');
    btnSend.disabled = data.busy;
    btnStop.disabled = !data.busy;
    renderMessages();
    if (data.error && !data.busy) setStatus(false, data.error);
  } catch (err) {
    setStatus(false, err.message);
  }
}

async function send() {
  const text = inputEl.value.trim();
  if (!text || state.busy) return;
  inputEl.value = '';
  try {
    await api('/api/send', { method: 'POST', body: JSON.stringify({ text }) });
    state.busy = true;
    state.partial = '';
    state.messages.push({ role: 'user', text });
    lastRenderKey = '';
    renderMessages();
  } catch (err) {
    alert('发送失败: ' + err.message);
    inputEl.value = text;
  }
}

btnSend.onclick = send;
inputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); }
});
el('btnNew').onclick = async () => {
  try { await api('/api/new', { method: 'POST', body: '{}' }); lastRenderKey = ''; await tick(); await loadConversations(); }
  catch (err) { alert('新建失败: ' + err.message); }
};
el('btnStop').onclick = async () => {
  try { await api('/api/stop', { method: 'POST', body: '{}' }); } catch (err) { alert(err.message); }
};
el('btnRefresh').onclick = () => { lastRenderKey = ''; tick(); loadConversations(); };
el('btnReconnect').onclick = async () => {
  setStatus(false, '正在重连客户端…');
  try { await api('/api/reconnect', { method: 'POST', body: '{}' }); await tick(); await loadConversations(); }
  catch (err) { setStatus(false, err.message); }
};

tick();
loadConversations();
setInterval(tick, 900);
setInterval(loadConversations, 8000);
