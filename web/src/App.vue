<script setup>
import { onMounted, ref } from 'vue';
import { api, connectEvents, disconnectEvents, live } from './api';
import SetupView from './views/SetupView.vue';
import LoginView from './views/LoginView.vue';
import DashboardView from './views/DashboardView.vue';
import SettingsView from './views/SettingsView.vue';

// loading | setup | login | app
const view = ref('loading');
const tab = ref('dashboard');
const error = ref('');

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

onMounted(refreshAuth);
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div class="brand">Steam Idler</div>
      <nav v-if="view === 'app'" class="tabs">
        <button :class="{ active: tab === 'dashboard' }" @click="tab = 'dashboard'">概览</button>
        <button :class="{ active: tab === 'settings' }" @click="tab = 'settings'">设置</button>
      </nav>
      <div v-if="view === 'app'" class="topbar-right">
        <span class="dot" :class="live.connected ? 'ok' : 'off'" :title="live.connected ? '实时连接正常' : '实时连接已断开，正在重连'"></span>
        <button class="link" @click="logoutPanel">退出面板</button>
      </div>
    </header>

    <main class="content">
      <p v-if="error" class="alert error">{{ error }}</p>
      <p v-else-if="view === 'loading'" class="muted">加载中…</p>
      <SetupView v-else-if="view === 'setup'" @done="enterApp" />
      <LoginView v-else-if="view === 'login'" @done="enterApp" />
      <template v-else>
        <DashboardView v-if="tab === 'dashboard'" />
        <SettingsView v-else />
      </template>
    </main>
  </div>
</template>
