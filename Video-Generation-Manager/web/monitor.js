'use strict';
(function(){
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const STATUS_LABELS = { queued: '排队中', starting: '启动中', configuring: '设置参数', uploading: '上传参考图', submitting: '发送中', generating: '生成中', downloading: '下载中', paused: '等待处理', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' };
const STATUS_COLORS = { completed: '#0e7c64', failed: '#b33b49', cancelled: '#8b9591', paused: '#c08b32', interrupted: '#b06b3f', running: '#2a5fd0', queued: '#8ba6b5' };
let dimension = localStorage.getItem('creative-desk-monitor-dimension') || 'month';
let loading = false;
let timer = null;

async function fetchMonitor() {
  const response = await fetch('/api/monitor?dimension=' + encodeURIComponent(dimension), { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || '监控数据读取失败');
  return data;
}

function fmtPercent(value) { return value == null ? '—' : value + '%'; }
function fmtDuration(ms) {
  if (!ms && ms !== 0) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return seconds + 's';
  return Math.floor(seconds / 60) + 'm' + String(seconds % 60).padStart(2, '0') + 's';
}

function renderKpis(data) {
  const s = data.summary;
  $('#mon-total').textContent = s.total;
  $('#mon-completion').textContent = fmtPercent(s.completionRate);
  $('#mon-quota').textContent = s.quotaUsed + ' / ' + s.quotaLimit;
  $('#mon-total-hint').textContent = data.range.label + ' · 进行中 ' + s.active;
  $('#mon-completion-hint').textContent = s.completed + ' 完成 · ' + s.failed + ' 失败 · ' + s.canceled + ' 取消';
  $('#mon-quota-hint').textContent = s.accountsEnabled + ' / ' + s.accounts + ' 个账号启用 · ' + s.accountsBusy + ' 个使用中';
  $('#monitor-range').textContent = data.range.label;
  $('#monitor-updated').textContent = '更新 ' + new Date(data.generatedAt).toLocaleTimeString('zh-CN', { hour12: false });
  $('#mon-trend-caption').textContent = data.range.label + ' · 平均处理耗时 ' + fmtDuration(s.avgProcessingMs);
}

function renderTrend(data) {
  const host = $('#monitor-trend');
  const series = data.series || [];
  const max = Math.max(1, ...series.map((bucket) => Math.max(bucket.created, bucket.completed, bucket.failed)));
  const width = Math.max(720, series.length * 44);
  const group = width / Math.max(1, series.length);
  const barWidth = Math.max(3, Math.min(8, group * 0.18));
  const rect = (value, x, color, label) => {
    if (!value) return '';
    const height = Math.max(2, Math.round((value / max) * 145));
    return '<rect x="' + x.toFixed(1) + '" y="' + (160 - height) + '" width="' + barWidth.toFixed(1) + '" height="' + height + '" rx="1.5" fill="' + color + '"><title>' + esc(label) + ': ' + value + '</title></rect>';
  };
  host.innerHTML = '<svg class="monitor-svg" viewBox="0 0 ' + width + ' 190" role="img" aria-label="任务趋势">' + series.map((bucket, index) => {
    const center = group * index + group / 2;
    const start = center - barWidth * 1.5;
    const title = bucket.key + ' 创建 ' + bucket.created + ' / 完成 ' + bucket.completed + ' / 失败 ' + bucket.failed;
    return '<g><title>' + esc(title) + '</title>' + rect(bucket.created, start, '#9bb7c5', '创建') + rect(bucket.completed, start + barWidth + 2, '#0e7c64', '完成') + rect(bucket.failed, start + (barWidth + 2) * 2, '#b33b49', '失败') + '<text x="' + center.toFixed(1) + '" y="181" text-anchor="middle" fill="#64736d" font-size="9">' + esc(bucket.label) + '</text></g>';
  }).join('') + '</svg>';
}

function renderStatus(data) {
  const host = $('#monitor-status');
  const total = (data.statuses || []).reduce((sum, row) => sum + row.count, 0);
  if (!total) { host.innerHTML = '<div class="hint">这个时间范围还没有任务。</div>'; return; }
  const circumference = 2 * Math.PI * 15.9;
  let offset = 0;
  const arcs = data.statuses.map((row) => {
    const length = row.count / total * circumference;
    const arc = '<circle cx="21" cy="21" r="15.9" fill="none" stroke="' + (STATUS_COLORS[row.status] || '#8ba6b5') + '" stroke-width="6" stroke-dasharray="' + length.toFixed(2) + ' ' + (circumference - length).toFixed(2) + '" stroke-dashoffset="' + (-offset).toFixed(2) + '" transform="rotate(-90 21 21)"></circle>';
    offset += length;
    return arc;
  }).join('');
  host.innerHTML = '<div class="monitor-status-wrap"><div class="monitor-donut"><svg viewBox="0 0 42 42" aria-hidden="true"><circle cx="21" cy="21" r="15.9" fill="none" stroke="#eef3f1" stroke-width="6"></circle>' + arcs + '</svg><b>' + total + '</b><span>任务</span></div><div class="monitor-status-legend">' + data.statuses.map((row) => '<div><i data-status="' + esc(row.status) + '"></i><span>' + esc(STATUS_LABELS[row.status] || row.status) + '</span><b>' + row.count + '</b></div>').join('') + '</div></div>';
}

function renderParams(data) {
  const host = $('#monitor-params');
  const groups = [['视频画幅', data.params.ratios], ['视频时长', data.params.durations], ['平台', data.params.platforms]];
  host.innerHTML = groups.map(([title, rows]) => {
    const total = (rows || []).reduce((sum, row) => sum + row.count, 0) || 1;
    return '<div class="monitor-param-group"><h3>' + title + '</h3>' + ((rows || []).length ? rows.map((row) => '<div class="monitor-param-row"><span>' + esc(row.label) + '</span><div class="monitor-param-bar"><progress max="' + total + '" value="' + row.count + '"></progress></div><b>' + row.count + '</b></div>').join('') : '<div class="hint">暂无数据</div>') + '</div>';
  }).join('');
}

function renderAccounts(data) {
  const host = $('#monitor-accounts');
  if (!data.accounts.length) { host.innerHTML = '<div class="hint">还没有账号。</div>'; return; }
  host.innerHTML = '<div class="table-scroll"><table><thead><tr><th>账号</th><th>平台</th><th>状态</th><th>今日额度</th><th>本范围任务</th><th>完成 / 失败</th></tr></thead><tbody>' + data.accounts.map((account) => {
    const quota = account.quota || {};
    const used = Number(quota.used) || 0, limit = Number(quota.limit) || 0;
    const status = !account.enabled ? '已停用' : account.busy ? '使用中' : used >= limit ? '额度用完' : account.cooldownUntil > Date.now() ? '冷却中' : '可用';
    const cls = status === '可用' ? 'ok' : status === '使用中' ? 'info' : 'warn';
    return '<tr><td><strong>' + esc(account.name) + '</strong></td><td>' + esc(account.platform) + '</td><td><span class="badge ' + cls + '">' + status + '</span></td><td><div class="monitor-quota"><progress max="' + Math.max(1, limit) + '" value="' + Math.min(used, Math.max(1, limit)) + '"></progress><span>' + used + ' / ' + limit + '</span></div></td><td>' + account.tasks + '</td><td>' + account.completed + ' / ' + account.failed + '</td></tr>';
  }).join('') + '</tbody></table></div>';
}

function render(data) {
  state = data;
  renderKpis(data);
  renderTrend(data);
  renderStatus(data);
  renderParams(data);
  renderAccounts(data);
}

let state = null;
async function refresh() {
  if (loading) return;
  loading = true;
  try {
    const data = await fetchMonitor();
    render(data);
  } catch (error) {
    const notice = $('#notice');
    if (notice) { notice.textContent = error.message; notice.hidden = false; }
  } finally { loading = false; }
}

function setDimension(next) {
  if (!['month', 'day', 'hour'].includes(next)) return;
  dimension = next;
  localStorage.setItem('creative-desk-monitor-dimension', dimension);
  document.querySelectorAll('[data-dimension]').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.dimension === dimension)));
  refresh();
}

document.querySelectorAll('[data-dimension]').forEach((button) => button.addEventListener('click', () => setDimension(button.dataset.dimension)));
$('#monitor-refresh')?.addEventListener('click', refresh);
setDimension(dimension);
timer = setInterval(() => { if (!document.hidden) refresh(); }, 10000);
window.addEventListener('beforeunload', () => clearInterval(timer));
})();
