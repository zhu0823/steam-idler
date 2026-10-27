<script setup>
// 账号卡片上的当前阶段摘要
import { computed } from 'vue';
import DropPips from './DropPips.vue';
import Icon from './Icon.vue';
import { fmtDuration } from '../api';

const props = defineProps({ account: { type: Object, required: true } });

const phase = computed(() => props.account.phase || { mode: 'idle' });
const progress = computed(() => {
  const p = phase.value;
  return p.mode === 'multi' && p.threshold > 0 ? Math.min(p.maxHours / p.threshold, 1) * 100 : 0;
});
const toSolo = computed(() => fmtDuration(phase.value.minutesToSolo).join(' '));
</script>

<template>
  <div v-if="account.state === 'auth_failed'" class="callout err">
    <Icon name="alert" />
    <div><b>凭据已失效</b><br />可能修改了密码或撤销了设备授权，需要重新登录。</div>
  </div>

  <div v-else-if="account.state === 'blocked'" class="callout warn">
    <Icon name="info" />
    <div>账号正在其他设备上游戏，挂卡已自动暂停，结束游戏后会自动恢复。</div>
  </div>

  <div v-else-if="phase.mode === 'multi'" class="phase">
    <div class="phase-top">
      <b>同时挂 {{ account.playing.length }} 个游戏 · 累计时长</b>
      <span class="num">{{ phase.maxHours }}h / {{ phase.threshold }}h</span>
    </div>
    <div class="bar"><i :style="{ width: `${progress}%` }"></i></div>
    <span class="phase-note">{{ phase.minutesToSolo > 0 ? `约 ${toSolo}后开始逐个单独挂卡` : '即将开始逐个单独挂卡' }}</span>
  </div>

  <div v-else-if="phase.mode === 'solo'" class="phase">
    <div class="phase-top">
      <b>单独挂：{{ phase.game.name }}</b>
      <span class="num">{{ phase.game.hours }}h</span>
    </div>
    <div class="row small muted"><DropPips :count="phase.game.drops" /> 还能掉 {{ phase.game.drops }} 张</div>
  </div>

  <div v-else class="phase">
    <div class="phase-top">
      <b>{{ account.config.paused ? '已暂停' : account.lastCheckAt ? '暂无可挂的游戏' : '等待读取徽章页' }}</b>
    </div>
    <span class="phase-note">
      {{ account.config.paused ? '恢复后会立即重新检查' : account.lastCheckAt ? '程序会继续定期检查，有新的可掉卡游戏时自动开始' : '登录完成后会自动读取' }}
    </span>
  </div>
</template>
