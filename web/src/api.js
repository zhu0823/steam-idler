import { reactive } from 'vue';

export async function api(method, url, body) {
  const init = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') {
    // 写操作统一发送 JSON，后端据此做 CSRF 校验
    init.headers['Content-Type'] = 'application/json';
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
  source.addEventListener('log', (e) => {
    live.logs.push(JSON.parse(e.data));
    if (live.logs.length > MAX_LOGS) live.logs.splice(0, live.logs.length - MAX_LOGS);
  });
  source.addEventListener('error', async () => {
    live.connected = false;
    // EventSource 无法读取状态码，断开时确认是否是会话失效
    try {
      const state = await api('GET', '/api/auth/state');
      if (!state.authenticated) {
        disconnectEvents();
        onAuthLost();
      }
    } catch {}
  });
}

export function disconnectEvents() {
  if (source) source.close();
  source = null;
  live.connected = false;
}

export function fmtTime(value) {
  if (!value) return '—';
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}
