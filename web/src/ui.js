import { reactive } from 'vue';

// 界面导航状态（无路由库，单页内切换）
export const ui = reactive({
  page: 'overview', // overview | account | settings
  accountId: null,
  accountTab: 'games', // games | settings | logs
  overviewTab: 'accounts', // accounts | logs
  // 添加账号弹窗；relogin 为要重新登录的账号名，新增账号时为空
  addOpen: false,
  relogin: '',
});

export function openAccount(id, tab = 'games') {
  if (ui.accountId !== id) ui.accountTab = tab;
  ui.accountId = id;
  ui.page = 'account';
  window.scrollTo({ top: 0 });
}

export function openPage(page) {
  ui.page = page;
  window.scrollTo({ top: 0 });
}

export function openAdd(relogin = '') {
  ui.relogin = relogin;
  ui.addOpen = true;
}

// 主题：默认跟随系统，手动切换后记住选择
const THEME_KEY = 'steam-idler-theme';

function systemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function currentTheme() {
  return document.documentElement.dataset.theme || systemTheme();
}

export function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch {}
  document.documentElement.dataset.theme = saved || systemTheme();
}

export function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {}
  return next;
}
