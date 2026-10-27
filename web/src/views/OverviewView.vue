<script setup>
import { computed, ref } from 'vue';
import { accountName, api, fmtClock, fmtDuration, live } from '../api';
import { openAccount, openAdd, ui } from '../ui';
import Icon from '../components/Icon.vue';
import AccountAvatar from '../components/AccountAvatar.vue';
import StateChip from '../components/StateChip.vue';
import PhaseSummary from '../components/PhaseSummary.vue';
import LogList from '../components/LogList.vue';

const accounts = computed(() => live.status?.accounts || []);
const logFilter = ref('all');
const error = ref('');

const stats = computed(() => {
  const list = accounts.value;
  const running = list.filter((a) => a.state === 'running').length;
  const failed = list.filter((a) => a.state === 'auth_failed').length;
  const playing = list.reduce((s, a) => s + a.playing.length, 0);
  const warming = list.filter((a) => a.phase?.mode === 'multi').reduce((s, a) => s + a.playing.length, 0);
  const solo = list.filter((a) => a.phase?.mode === 'solo').length;
  const drops = list.reduce((s, a) => s + a.totalDrops, 0);
  const today = list.reduce((s, a) => s + (a.dropsToday || 0), 0);
  // 各账号并行挂卡，全部完成时间取最慢的账号
  const etas = list.map((a) => a.etaMinutes).filter((m) => m !== null && m !== undefined);
  const eta = etas.length ? Math.max(...etas) : null;
  const next = list.map((a) => a.nextCheckAt).filter(Boolean).sort()[0] || null;
  return { running, failed, playing, warming, solo, drops, today, eta, next };
});

const errorCount = computed(() => live.logs.filter((l) => l.level === 'error').length);
const etaText = computed(() => fmtDuration(stats.value.eta));

async function call(url, confirmText) {
  if (confirmText && !window.confirm(confirmText)) return;
  error.value = '';
  try {
    await api('POST', url);
  } catch (err) {
    error.value = err.message;
  }
}
</script>

<template>
  <div class="page-head">
    <div>
      <h1 class="page-title">概览</h1>
      <p class="page-sub">{{ accounts.length }} 个账号<template v-if="stats.next"> · 下次定时检查 {{ fmtClock(stats.next) }}</template></p>
    </div>
    <div v-if="accounts.length" class="btn-group">
      <button class="btn" @click="call('/api/bulk/pause', '确定暂停所有账号的挂卡吗？')"><Icon name="pause" />全部暂停</button>
      <button class="btn" @click="call('/api/bulk/resume')"><Icon name="play" />全部恢复</button>
      <button class="btn" @click="call('/api/bulk/check')"><Icon name="refresh" />全部检查</button>
    </div>
  </div>

  <p v-if="error" class="callout err"><Icon name="alert" />{{ error }}</p>

  <section class="kpis">
    <div class="card kpi">
      <span class="kpi-label">挂卡中账号</span>
      <span class="kpi-value">{{ stats.running }}<small>/ {{ accounts.length }}</small></span>
      <span class="kpi-foot">{{ stats.failed ? `${stats.failed} 个需要重新登录` : '全部正常' }}</span>
    </div>
    <div class="card kpi">
      <span class="kpi-label">正在挂的游戏</span>
      <span class="kpi-value">{{ stats.playing }}</span>
      <span class="kpi-foot">{{ stats.warming }} 个累计时长 · {{ stats.solo }} 个掉卡中</span>
    </div>
    <div class="card kpi">
      <span class="kpi-label"><Icon name="card" />待掉卡片</span>
      <span class="kpi-value drop">{{ stats.drops }}</span>
      <span class="kpi-foot">今日已掉 {{ stats.today }} 张</span>
    </div>
    <div class="card kpi">
      <span class="kpi-label">预计全部掉完</span>
      <span class="kpi-value">{{ etaText[0] }}<small>{{ etaText[1] }}</small></span>
      <span class="kpi-foot">按每张约 30 分钟估算</span>
    </div>
  </section>

  <div class="section-head">
    <div class="section-tabs" role="tablist">
      <button :class="{ on: ui.overviewTab === 'accounts' }" @click="ui.overviewTab = 'accounts'">账号<span class="count">{{ accounts.length }}</span></button>
      <button :class="{ on: ui.overviewTab === 'logs' }" @click="ui.overviewTab = 'logs'">
        日志<span v-if="errorCount" class="count err">{{ errorCount }}</span>
      </button>
    </div>
    <button v-if="ui.overviewTab === 'accounts'" class="btn sm" @click="openAdd()"><Icon name="plus" />添加账号</button>
    <select v-else v-model="logFilter" class="select" style="width: auto; height: 30px; font-size: 12px">
      <option value="all">全部账号</option>
      <option v-for="a in accounts" :key="a.id" :value="a.id">{{ accountName(a) }}</option>
      <option value="system">仅系统</option>
    </select>
  </div>

  <template v-if="ui.overviewTab === 'accounts'">
    <section v-if="accounts.length" class="acct-grid">
      <article v-for="a in accounts" :key="a.id" class="card acct-card" @click="openAccount(a.id)">
        <div class="acct-head">
          <AccountAvatar :account="a" />
          <div class="meta">
            <div class="name">{{ accountName(a) }}</div>
            <div class="sub mono">{{ a.id }}</div>
          </div>
          <StateChip :state="a.state" />
        </div>
        <PhaseSummary :account="a" />
        <div class="acct-foot">
          <div class="stats">
            <span><b>{{ a.games.filter((g) => !g.skipped).length }}</b> 个游戏</span>
            <span class="drop"><b>{{ a.totalDrops }}</b> 张待掉</span>
          </div>
          <button v-if="a.state === 'auth_failed'" class="btn sm primary" @click.stop="openAdd(accountName(a))">重新登录</button>
          <button v-else-if="a.config.paused" class="btn sm" @click.stop="call(`/api/accounts/${a.id}/resume`)"><Icon name="play" />恢复</button>
          <button v-else class="btn sm" @click.stop="call(`/api/accounts/${a.id}/pause`)"><Icon name="pause" />暂停</button>
        </div>
      </article>
    </section>
    <section v-else class="card empty">
      <span class="brand-mark" style="width: 44px; height: 44px; border-radius: 12px"><Icon name="logo" /></span>
      <div>
        <div style="color: var(--text); font-weight: 600">还没有 Steam 账号</div>
        <div class="small">添加账号后会自动读取徽章页并开始挂卡</div>
      </div>
      <button class="btn primary" @click="openAdd()"><Icon name="plus" />添加账号</button>
    </section>
  </template>

  <section v-else class="card">
    <LogList :filter="logFilter" />
  </section>
</template>
