<script setup>
// 账号详情的两阶段挂卡进度
import { computed } from 'vue';
import { fmtClock, fmtDuration } from '../api';
import DropPips from './DropPips.vue';
import Icon from './Icon.vue';

const props = defineProps({ account: { type: Object, required: true } });

const phase = computed(() => props.account.phase || { mode: 'idle', threshold: props.account.config.hoursUntilDrops });
const threshold = computed(() => props.account.config.hoursUntilDrops);
const active = computed(() => props.account.games.filter((g) => !g.skipped));
const notReady = computed(() => (threshold.value > 0 ? active.value.filter((g) => g.hours < threshold.value) : []));
const ready = computed(() => active.value.length - notReady.value.length);
const progress = computed(() => (phase.value.mode === 'multi' && threshold.value > 0 ? Math.min(phase.value.maxHours / threshold.value, 1) * 100 : 0));

const step1State = computed(() => {
  if (phase.value.mode === 'multi') return '进行中';
  return notReady.value.length ? '等待中' : '已完成';
});
const step2State = computed(() => (phase.value.mode === 'solo' ? '进行中' : ready.value ? '等待中' : '未开始'));
</script>

<template>
  <section class="card card-pad stack" style="gap: 14px">
    <div class="card-title">
      挂卡进度
      <small>每 {{ account.config.checkIntervalMinutes }} 分钟检查一次<template v-if="account.nextCheckAt"> · 下次 {{ fmtClock(account.nextCheckAt) }}</template></small>
    </div>

    <p v-if="threshold <= 0" class="callout info small"><Icon name="info" />时长阈值为 0：跳过累计时长阶段，始终逐个单独挂。</p>

    <div class="flow">
      <div class="flow-step" :class="{ current: phase.mode === 'multi' }">
        <div class="k"><span>阶段 1</span><span>{{ step1State }}</span></div>
        <div class="v">同时挂，累计时长</div>
        <template v-if="phase.mode === 'multi'">
          <div class="d">{{ account.playing.length }} 个游戏未满 {{ threshold }} 小时，同时挂以并行跨过掉卡门槛</div>
          <div class="bar"><i :style="{ width: `${progress}%` }"></i></div>
          <div class="d num">时长最多的游戏 {{ phase.maxHours }}h / {{ threshold }}h · 约 {{ fmtDuration(phase.minutesToSolo).join(' ') }}后切换</div>
        </template>
        <div v-else class="d">
          {{ notReady.length ? `还有 ${notReady.length} 个游戏未满 ${threshold} 小时，单独挂的游戏掉完后继续` : `所有游戏已满 ${threshold} 小时` }}
        </div>
      </div>

      <div class="flow-arrow"><Icon name="arrow" /></div>

      <div class="flow-step" :class="{ current: phase.mode === 'solo' }">
        <div class="k"><span>阶段 2</span><span>{{ step2State }}</span></div>
        <div class="v">逐个单独挂，掉卡</div>
        <template v-if="phase.mode === 'solo'">
          <div class="d">正在挂 {{ phase.game.name }}，掉完自动换下一个</div>
          <div class="row d"><DropPips :count="phase.game.drops" /> 还能掉 {{ phase.game.drops }} 张</div>
        </template>
        <div v-else class="d">满 {{ threshold }} 小时后按时长从多到少逐个挂{{ ready ? `，已有 ${ready} 个游戏满足` : '' }}</div>
      </div>
    </div>
  </section>
</template>
