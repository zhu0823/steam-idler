<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, connectEvents, disconnectEvents, live } from './api';
import { currentTheme, openAccount, openPage, toggleTheme, ui } from './ui';
import Icon from './components/Icon.vue';
import AppSidebar from './components/AppSidebar.vue';
import AddAccountModal from './components/AddAccountModal.vue';
import SetupView from './views/SetupView.vue';
import LoginView from './views/LoginView.vue';
import OverviewView from './views/OverviewView.vue';
import AccountView from './views/AccountView.vue';
import SettingsView from './views/SettingsView.vue';

// loading | setup | login | app
const view = ref('loading');
const error = ref('');
const theme = ref(currentTheme());

const accounts = computed(() => live.status?.accounts || []);
// 账号被移除后回到概览
const selected = computed(() => accounts.value.find((a) => a.id === ui.accountId) || null);
const page = computed(() => (ui.page === 'account' && !selected.value ? 'overview' : ui.page));

async function refreshAuth() {
  try {
    const state = await api('GET', '/api/auth/state');
    error.value = '';
    if (!state.initialized) view.value = 'setup';
    else if (!state.authenticated) view.value = 'login';
    else enterApp();
  } catch (err) {
    error.value = `无法连接服务：${err.message}`;
  }
}

function enterApp() {
  view.value = 'app';
  connectEvents(() => (view.value = 'login'));
}

async function logoutPanel() {
  await api('POST', '/api/auth/logout').catch(() => {});
  disconnectEvents();
  view.value = 'login';
}

function onToggleTheme() {
  theme.value = toggleTheme();
}

// 手机底部导航的“账号”：打开当前或第一个账号
function openAccountsTab() {
  const id = selected.value?.id || accounts.value[0]?.id;
  if (id) openAccount(id);
  else openPage('overview');
}

onMounted(refreshAuth);
</script>

<template>
  <div class="app">
    <div v-if="error" class="auth-wrap">
      <div class="card auth-card">
        <p class="callout err"><Icon name="alert" />{{ error }}</p>
        <button class="btn" @click="refreshAuth">重试</button>
      </div>
    </div>
    <div v-else-if="view === 'loading'" class="auth-wrap muted">加载中…</div>
    <SetupView v-else-if="view === 'setup'" @done="enterApp" />
    <LoginView v-else-if="view === 'login'" @done="enterApp" />

    <div v-else class="shell">
      <AppSidebar :theme="theme" @logout="logoutPanel" @toggle-theme="onToggleTheme" />

      <div class="main">
        <header class="topbar">
          <div class="brand">
            <span class="brand-mark"><Icon name="logo" /></span>
            <div class="brand-name">Steam Idler</div>
          </div>
          <div class="row">
            <span class="live small muted" :class="{ off: !live.connected }">{{ live.connected ? '实时' : '重连中' }}</span>
            <button class="btn sm icon-only" :title="theme === 'dark' ? '切换到浅色' : '切换到深色'" @click="onToggleTheme">
              <Icon :name="theme === 'dark' ? 'sun' : 'moon'" />
            </button>
            <button class="btn sm" @click="logoutPanel">退出</button>
          </div>
        </header>

        <main class="content">
          <p v-if="!live.status" class="muted">正在获取状态…</p>
          <template v-else>
            <AccountView v-if="page === 'account'" :account="selected" />
            <SettingsView v-else-if="page === 'settings'" />
            <OverviewView v-else />
          </template>
        </main>

        <nav class="bottom-nav">
          <button :class="{ active: page === 'overview' }" @click="openPage('overview')"><Icon name="home" />概览</button>
          <button :class="{ active: page === 'account' }" @click="openAccountsTab"><Icon name="users" />账号</button>
          <button :class="{ active: page === 'settings' }" @click="openPage('settings')"><Icon name="gear" />设置</button>
        </nav>
      </div>

      <AddAccountModal v-if="ui.addOpen" />
    </div>
  </div>
</template>
