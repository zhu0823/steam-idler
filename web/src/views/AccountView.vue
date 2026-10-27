<script setup>
import { computed, ref } from 'vue';
import { accountName, api, fmtClock, fmtDate, fmtDuration } from '../api';
import { openAdd, openPage, ui } from '../ui';
import Icon from '../components/Icon.vue';
import AccountAvatar from '../components/AccountAvatar.vue';
import StateChip from '../components/StateChip.vue';
import PhaseFlow from '../components/PhaseFlow.vue';
import GamesTable from '../components/GamesTable.vue';
import AccountSettingsTab from '../components/AccountSettingsTab.vue';
import LogList from '../components/LogList.vue';

const props = defineProps({ account: { type: Object, required: true } });

const name = computed(() => accountName(props.account));
const failed = computed(() => props.account.state === 'auth_failed');
const activeGames = computed(() => props.account.games.filter((g) => !g.skipped).length);
const eta = computed(() => fmtDuration(props.account.etaMinutes));
const error = ref('');

const tabs = computed(() => [
  ['games', '游戏', props.account.games.length],
  ['drops', '掉卡记录', props.account.recentDrops?.length || undefined],
  ['settings', '账号设置'],
  ['logs', '日志'],
]);

async function action(path, confirmText) {
  if (confirmText && !window.confirm(confirmText)) return;
  error.value = '';
  try {
    await api('POST', `/api/accounts/${props.account.id}/${path}`);
    if (path === 'remove') openPage('overview');
  } catch (err) {
    error.value = err.message;
  }
}
</script>

<template>
  <div class="crumb">
    <button @click="openPage('overview')">概览</button><span>/</span><span>{{ name }}</span>
  </div>

  <div v-if="failed" class="callout err">
    <Icon name="alert" />
    <div>
      <b>该账号的登录凭据已失效</b>，挂卡已停止。可能修改了 Steam 密码、撤销了设备授权或凭据已过期。
      <div style="margin-top: 10px"><button class="btn sm primary" @click="openAdd(name)">重新登录 {{ name }}</button></div>
    </div>
  </div>

  <section class="card hero">
    <AccountAvatar :account="account" large />
    <div class="meta">
      <div class="name">{{ name }} <StateChip :state="account.state" /></div>
      <div class="sub">
        <span class="mono">{{ account.id }}</span>
        <span>凭据有效期至 {{ fmtDate(account.account?.tokenExpiresAt) }}</span>
      </div>
    </div>
    <div class="actions">
      <template v-if="!failed">
        <button v-if="account.config.paused" class="btn primary" @click="action('resume')"><Icon name="play" />恢复</button>
        <button v-else class="btn" @click="action('pause')"><Icon name="pause" />暂停</button>
        <button class="btn" :disabled="account.state !== 'running'" @click="action('check')"><Icon name="refresh" />立即检查</button>
      </template>
      <button class="btn ghost" @click="openAdd(name)">重新登录</button>
      <button class="btn danger" @click="action('remove', `确定移除账号 ${name} 吗？会退出 Steam 登录并删除该账号的凭据、设置和掉卡记录。`)">移除</button>
    </div>
  </section>

  <p v-if="error" class="callout err"><Icon name="alert" />{{ error }}</p>
  <p v-if="account.lastError && !failed && account.state !== 'running'" class="callout warn small"><Icon name="info" />最近错误：{{ account.lastError }}</p>

  <section v-if="!failed" class="kpis">
    <div class="card kpi">
      <span class="kpi-label">可掉卡游戏</span>
      <span class="kpi-value">{{ activeGames }}</span>
      <span class="kpi-foot">{{ account.playing.length }} 个正在挂</span>
    </div>
    <div class="card kpi">
      <span class="kpi-label"><Icon name="card" />待掉卡片</span>
      <span class="kpi-value drop">{{ account.totalDrops }}</span>
      <span class="kpi-foot">今日已掉 {{ account.dropsToday || 0 }} 张</span>
    </div>
    <div class="card kpi">
      <span class="kpi-label">预计全部掉完</span>
      <span class="kpi-value">{{ eta[0] }}<small>{{ eta[1] }}</small></span>
      <span class="kpi-foot">按每张约 30 分钟估算</span>
    </div>
    <div class="card kpi">
      <span class="kpi-label">上次检查</span>
      <span class="kpi-value text">{{ fmtClock(account.lastCheckAt) }}</span>
      <span class="kpi-foot">下次 {{ fmtClock(account.nextCheckAt) }}</span>
    </div>
  </section>

  <PhaseFlow v-if="!failed && account.lastCheckAt" :account="account" />

  <section class="card">
    <div class="tabs" role="tablist">
      <button v-for="[key, label, count] in tabs" :key="key" class="tab" :class="{ active: ui.accountTab === key }" @click="ui.accountTab = key">
        {{ label }}<span v-if="count !== undefined" class="count">{{ count }}</span>
      </button>
    </div>

    <GamesTable v-if="ui.accountTab === 'games'" :account="account" />

    <template v-else-if="ui.accountTab === 'drops'">
      <div v-if="!account.recentDrops?.length" class="empty small">还没有掉卡记录。检查到剩余掉落减少时会记录在这里（保留 30 天）。</div>
      <div v-else>
        <div v-for="(d, i) in account.recentDrops" :key="i" class="drop-item">
          <span class="mono muted small">{{ fmtClock(d.time) }}</span>
          <span>{{ d.name }} <span class="muted mono small">{{ d.appid }}</span></span>
          <span class="drop-text">+{{ d.count }} 张</span>
        </div>
      </div>
    </template>

    <AccountSettingsTab v-else-if="ui.accountTab === 'settings'" :account="account" />

    <LogList v-else :filter="account.id" single />
  </section>
</template>
