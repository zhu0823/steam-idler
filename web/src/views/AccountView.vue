<script setup>
import { computed, ref, watch } from 'vue';
import { STATE_TEXT, accountName, api, fmtTime, live } from '../api';
import SteamLogin from '../components/SteamLogin.vue';
import AccountSettings from '../components/AccountSettings.vue';
import LogPanel from '../components/LogPanel.vue';

const props = defineProps({ account: { type: Object, required: true } });
const emit = defineEmits(['back']);

const name = computed(() => accountName(props.account));
const state = computed(() => STATE_TEXT[props.account.state] || ['—', 'off']);
const playingIds = computed(() => new Set((props.account.playing || []).map((g) => g.appid)));
const showLogin = ref(false);
const authFailed = computed(() => props.account.state === 'auth_failed');
const error = ref('');

const games = computed(() =>
  [...(props.account.games || [])].sort((a, b) => {
    const rank = (g) => (playingIds.value.has(g.appid) ? 0 : g.skipped ? 2 : 1);
    return rank(a) - rank(b) || b.hours - a.hours;
  }),
);

async function action(path, confirmText) {
  if (confirmText && !window.confirm(confirmText)) return;
  error.value = '';
  try {
    await api('POST', `/api/accounts/${props.account.id}/${path}`);
    if (path === 'remove') emit('back');
  } catch (err) {
    error.value = err.message;
  }
}

watch(
  () => live.login?.state,
  (s) => {
    if (s === 'authenticated') showLogin.value = false;
  },
);
</script>

<template>
  <div class="row">
    <button class="link" @click="emit('back')">← 返回账号列表</button>
  </div>

  <SteamLogin
    v-if="authFailed || showLogin"
    title="重新登录 Steam"
    :reason="authFailed ? '该账号的登录凭据已失效（可能修改了密码、撤销了设备授权或已过期），请重新登录。' : ''"
    :hint="`请使用 ${name} 登录；登录其他账号会作为新账号添加。`"
  />

  <section class="card">
    <div class="card-head">
      <div>
        <h2>{{ name }}</h2>
        <p class="muted small">SteamID {{ account.id }} · 凭据有效期至 {{ fmtTime(account.account?.tokenExpiresAt) }}</p>
      </div>
      <span class="badge" :class="state[1]">{{ state[0] }}</span>
    </div>
    <p v-if="account.lastError && account.state !== 'running'" class="alert warn small">最近错误：{{ account.lastError }}</p>
    <div class="row wrap">
      <button v-if="account.config.paused" class="primary" @click="action('resume')">恢复挂卡</button>
      <button v-else @click="action('pause')">暂停挂卡</button>
      <button :disabled="account.state !== 'running'" @click="action('check')">立即检查</button>
      <button v-if="!authFailed" @click="showLogin = !showLogin">{{ showLogin ? '收起登录' : '重新登录' }}</button>
      <button class="danger" @click="action('remove', `确定移除账号 ${name} 吗？会退出 Steam 登录并删除该账号的凭据和设置。`)">移除账号</button>
    </div>
    <p v-if="error" class="alert error">{{ error }}</p>
  </section>

  <section class="stats">
    <div class="stat"><span class="stat-value">{{ account.games.filter((g) => !g.skipped).length }}</span><span class="stat-label">可掉卡游戏</span></div>
    <div class="stat"><span class="stat-value">{{ account.totalDrops }}</span><span class="stat-label">剩余卡片</span></div>
    <div class="stat"><span class="stat-value small">{{ fmtTime(account.lastCheckAt) }}</span><span class="stat-label">上次检查</span></div>
    <div class="stat"><span class="stat-value small">{{ fmtTime(account.nextCheckAt) }}</span><span class="stat-label">下次定时检查</span></div>
  </section>

  <section class="card">
    <h2>游戏列表</h2>
    <p v-if="!account.lastCheckAt" class="muted">登录完成后会自动读取徽章页。</p>
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

  <AccountSettings :account="account" />

  <LogPanel :account-id="account.id" />
</template>
