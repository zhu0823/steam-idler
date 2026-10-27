import { reactive } from 'vue';

export async function api(method, url, body) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') {
    // 写操作统一发送 JSON 和自定义请求头，后端据此做 CSRF 校验
    init.headers['Content-Type'] = 'application/json';
    init.headers['X-Requested-With'] = 'steam-idler';
    init.body = JSON.stringify(body || {});
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `请求失败（HTTP ${res.status}）`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// 由 SSE 推送维护的全局状态
export const live = reactive({
  connected: false,
  status: null,
  login: null,
  logs: [],
});

const MAX_LOGS = 300;
let source = null;

export function connectEvents(onAuthLost) {
  disconnectEvents();
  source = new EventSource('/api/events');
  source.addEventListener('open', () => (live.connected = true));
  source.addEventListener('status', (e) => (live.status = JSON.parse(e.data)));
  source.addEventListener('login', (e) => (live.login = JSON.parse(e.data)));
  source.addEventListener('logs', (e) => (live.logs = JSON.parse(e.data)));
  // 服务端因会话失效主动断开。本页刚修改密码时已拿到新 Cookie，EventSource 会自动用新会话重连
  source.addEventListener('auth', () => checkAuth(onAuthLost));
  source.addEventListener('log', (e) => {
    live.logs.push(JSON.parse(e.data));
    if (live.logs.length > MAX_LOGS) live.logs.splice(0, live.logs.length - MAX_LOGS);
  });
  source.addEventListener('error', () => {
    live.connected = false;
    // EventSource 无法读取状态码，断开时确认是否是会话失效
    checkAuth(onAuthLost);
  });
}

async function checkAuth(onAuthLost) {
  try {
    const state = await api('GET', '/api/auth/state');
    if (!state.authenticated) {
      disconnectEvents();
      onAuthLost();
    }
  } catch {}
}

export function disconnectEvents() {
  if (source) source.close();
  source = null;
  live.connected = false;
}

export const STATE_TEXT = {
  logged_out: ['未登录', 'off'],
  connecting: ['连接中', 'warn'],
  running: ['挂卡中', 'ok'],
  paused: ['已暂停', 'warn'],
  blocked: ['其他设备游戏中', 'warn'],
  auth_failed: ['凭据失效', 'err'],
};

export const FARMING_ORDERS = [
  ['hours', '时长最多的优先'],
  ['fewestDrops', '剩余卡少的优先'],
  ['mostDrops', '剩余卡多的优先'],
  ['name', '按游戏名称'],
  ['badge', '徽章页顺序'],
];
export const FARMING_ORDER_TEXT = Object.fromEntries(FARMING_ORDERS);

export function accountName(account) {
  return account?.account?.accountName || account?.id || '';
}

export function fmtTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

// 时:分，跨天时带上日期
export function fmtClock(value) {
  if (!value) return '—';
  const d = new Date(value);
  const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toDateString() === new Date().toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

export function fmtDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('zh-CN');
}

// 分钟数转为“约 X 分钟 / X.X 小时 / X.X 天”
export function fmtDuration(minutes) {
  if (minutes === null || minutes === undefined) return ['—', ''];
  if (minutes < 60) return [String(Math.max(minutes, 0)), '分钟'];
  if (minutes < 48 * 60) return [(minutes / 60).toFixed(1).replace(/\.0$/, ''), '小时'];
  return [(minutes / 1440).toFixed(1).replace(/\.0$/, ''), '天'];
}

// 按 SteamID 稳定生成头像颜色
const AVATAR_COLORS = ['#3d8fd6', '#6f7cff', '#e0912f', '#3fb58a', '#c264d6', '#d6584f', '#2fa7b5', '#8a9a2a'];
export function avatarColor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
