<script setup>
import { computed, ref, watch } from 'vue';
import { STATE_TEXT, accountName, api, live } from '../api';
import SteamLogin from '../components/SteamLogin.vue';
import LogPanel from '../components/LogPanel.vue';
import AccountView from './AccountView.vue';

const accounts = computed(() => live.status?.accounts || []);
const selectedId = ref(null);
// 账号被移除后自动回到列表
const selected = computed(() => accounts.value.find((a) => a.id === selectedId.value) || null);
const showLogin = ref(false);
const error = ref('');

const totals = computed(() => ({
  playing: accounts.value.reduce((s, a) => s + a.playing.length, 0),
  drops: accounts.value.reduce((s, a) => s + a.totalDrops, 0),
  running: accounts.value.filter((a) => a.state === 'running').length,
}));

const stateOf = (a) => STATE_TEXT[a.state] || ['—', 'off'];

async function call(url, confirmText) {
  if (confirmText && !window.confirm(confirmText)) return;
  error.value = '';
  try {
    await api('POST', url);
  } catch (err) {
    error.value = err.message;
  }
}

function playingText(a) {
  if (a.playing.length === 0) return a.state === 'running' ? '暂无可挂的游戏' : '—';
  if (a.playing.length === 1) return `单独挂：${a.playing[0].name}`;
  return `同时挂 ${a.playing.length} 个游戏`;
}

watch(
  () => live.login?.state,
  (s) => {
    if (s === 'authenticated') showLogin.value = false;
  },
);
</script>

<template>
  <p v-if="!live.status" class="muted">正在获取状态…</p>

  <AccountView v-else-if="selected" :account="selected" @back="selectedId = null" />

  <template v-else>
    <section class="card">
      <div class="card-head">
        <div>
          <h2>Steam 账号（{{ accounts.length }}）</h2>
          <p class="muted small">
            {{ totals.running }} 个账号挂卡中 · 正在挂 {{ totals.playing }} 个游戏 · 共剩余 {{ totals.drops }} 张卡
          </p>
        </div>
        <button class="primary" @click="showLogin = !showLogin">{{ showLogin ? '收起' : '添加账号' }}</button>
      </div>
      <div v-if="accounts.length > 0" class="row wrap">
        <button @click="call('/api/bulk/pause', '确定暂停所有账号的挂卡吗？')">全部暂停</button>
        <button @click="call('/api/bulk/resume')">全部恢复</button>
        <button @click="call('/api/bulk/check')">全部立即检查</button>
      </div>
      <p v-if="error" class="alert error">{{ error }}</p>
    </section>

    <SteamLogin v-if="showLogin || accounts.length === 0" />

    <section v-if="accounts.length > 0" class="account-grid">
      <article v-for="a in accounts" :key="a.id" class="card account-card" @click="selectedId = a.id">
        <div class="card-head">
          <div>
            <h2>{{ accountName(a) }}</h2>
            <p class="muted small mono">{{ a.id }}</p>
          </div>
          <span class="badge" :class="stateOf(a)[1]">{{ stateOf(a)[0] }}</span>
        </div>
        <p class="small">{{ playingText(a) }}</p>
        <p class="muted small">可掉卡游戏 {{ a.games.filter((g) => !g.skipped).length }} 个 · 剩余 {{ a.totalDrops }} 张</p>
        <div class="row" @click.stop>
          <button v-if="a.config.paused" class="primary" @click="call(`/api/accounts/${a.id}/resume`)">恢复</button>
          <button v-else @click="call(`/api/accounts/${a.id}/pause`)">暂停</button>
          <button @click="selectedId = a.id">详情</button>
        </div>
      </article>
    </section>

    <LogPanel />
  </template>
</template>
