<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { api, fmtTime, live } from '../api';
import SteamLogin from '../components/SteamLogin.vue';

const STATE_TEXT = {
  logged_out: ['未登录 Steam', 'off'],
  connecting: ['连接中', 'warn'],
  running: ['挂卡中', 'ok'],
  paused: ['已暂停', 'warn'],
  blocked: ['其他设备游戏中，已暂停', 'warn'],
  auth_failed: ['登录凭据失效', 'error'],
};

const status = computed(() => live.status);
const state = computed(() => STATE_TEXT[status.value?.state] || ['—', 'off']);
const playingIds = computed(() => new Set((status.value?.playing || []).map((g) => g.appid)));
const showLogin = ref(false);
const needLogin = computed(() => !status.value?.account || status.value?.state === 'auth_failed');
const error = ref('');
const logBox = ref(null);

const games = computed(() =>
  [...(status.value?.games || [])].sort((a, b) => {
    const rank = (g) => (playingIds.value.has(g.appid) ? 0 : g.skipped ? 2 : 1);
    return rank(a) - rank(b) || b.hours - a.hours;
  }),
);

async function action(url, confirmText) {
  if (confirmText && !window.confirm(confirmText)) return;
  error.value = '';
  try {
    await api('POST', url);
  } catch (err) {
    error.value = err.message;
  }
}

// 登录成功后自动收起登录面板
watch(
  () => live.login?.state,
  (s) => {
    if (s === 'authenticated') showLogin.value = false;
  },
);

watch(
  () => live.logs.length,
  async () => {
    const el = logBox.value;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    await nextTick();
    if (atBottom) el.scrollTop = el.scrollHeight;
  },
);
</script>

<template>
  <p v-if="!status" class="muted">正在获取状态…</p>
  <template v-else>
    <SteamLogin
      v-if="needLogin || showLogin"
      :reason="status.state === 'auth_failed' ? 'Steam 登录凭据已失效（可能修改了密码、撤销了设备授权或已过期），请重新登录。' : ''"
    />

    <section v-if="status.account" class="card">
      <div class="card-head">
        <div>
          <h2>{{ status.account.accountName || 'Steam 账号' }}</h2>
          <p class="muted small">
            SteamID {{ status.account.steamID || '—' }} · 凭据有效期至 {{ fmtTime(status.account.tokenExpiresAt) }}
          </p>
        </div>
        <span class="badge" :class="state[1]">{{ state[0] }}</span>
      </div>
      <p v-if="status.lastError && status.state !== 'running'" class="alert warn small">最近错误：{{ status.lastError }}</p>
      <div class="row wrap">
        <button v-if="status.config.paused" class="primary" @click="action('/api/idler/resume')">恢复挂卡</button>
        <button v-else @click="action('/api/idler/pause')">暂停挂卡</button>
        <button :disabled="status.state !== 'running'" @click="action('/api/idler/check')">立即检查</button>
        <button v-if="!needLogin" @click="showLogin = !showLogin">{{ showLogin ? '收起登录' : '重新登录 Steam' }}</button>
        <button class="danger" @click="action('/api/steam/logout', '确定退出 Steam 登录并删除本地凭据吗？')">退出 Steam</button>
      </div>
      <p v-if="error" class="alert error">{{ error }}</p>
    </section>

    <section v-if="status.account" class="stats">
      <div class="stat"><span class="stat-value">{{ status.games.filter((g) => !g.skipped).length }}</span><span class="stat-label">可掉卡游戏</span></div>
      <div class="stat"><span class="stat-value">{{ status.totalDrops }}</span><span class="stat-label">剩余卡片</span></div>
      <div class="stat"><span class="stat-value small">{{ fmtTime(status.lastCheckAt) }}</span><span class="stat-label">上次检查</span></div>
      <div class="stat"><span class="stat-value small">{{ fmtTime(status.nextCheckAt) }}</span><span class="stat-label">下次定时检查</span></div>
    </section>

    <section v-if="status.account" class="card">
      <h2>游戏列表</h2>
      <p v-if="!status.lastCheckAt" class="muted">登录完成后会自动读取徽章页。</p>
      <p v-else-if="games.length === 0" class="muted">没有可掉卡的游戏，程序会继续定期检查。</p>
      <div v-else class="table-wrap">
        <table>
          <thead>
            <tr><th>游戏</th><th>AppID</th><th class="num">时长 (h)</th><th class="num">剩余掉落</th><th>状态</th></tr>
          </thead>
          <tbody>
            <tr v-for="g in games" :key="g.appid">
              <td>{{ g.name }}</td>
              <td class="mono">{{ g.appid }}</td>
              <td class="num">{{ g.hours }}</td>
              <td class="num">{{ g.drops }}</td>
              <td>
                <span v-if="playingIds.has(g.appid)" class="badge ok">挂卡中</span>
                <span v-else-if="g.skipped" class="badge off">已跳过</span>
                <span v-else class="badge">排队</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h2>运行日志</h2>
      <div ref="logBox" class="logs">
        <div v-for="(l, i) in live.logs" :key="i" class="log-line" :class="l.level">
          <span class="log-time">{{ fmtTime(l.time) }}</span>{{ l.message }}
        </div>
        <p v-if="live.logs.length === 0" class="muted">暂无日志</p>
      </div>
    </section>
  </template>
</template>
