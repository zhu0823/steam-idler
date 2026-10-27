<script setup>
import { computed } from 'vue';
import { avatarColor, fmtClock, live } from '../api';

// filter：all 全部 / system 仅系统 / 账号 SteamID；single 为账号详情内的单账号视图
const props = defineProps({
  filter: { type: String, default: 'all' },
  single: { type: Boolean, default: false },
});

// 最新的在最上面
const rows = computed(() => {
  const list = live.logs.filter((l) => {
    if (props.filter === 'all') return true;
    if (props.filter === 'system') return !l.accountId;
    return l.accountId === props.filter;
  });
  return list.slice().reverse();
});
</script>

<template>
  <div class="log" :class="{ single }">
    <div v-for="(l, i) in rows" :key="i" class="log-row" :class="l.level === 'info' ? '' : l.level">
      <span class="t mono" :title="new Date(l.time).toLocaleString('zh-CN')">{{ fmtClock(l.time) }}</span>
      <span v-if="!single" class="a">
        <i :style="{ background: l.accountId ? avatarColor(l.accountId) : 'var(--muted)' }"></i>{{ l.accountName || '系统' }}
      </span>
      <span class="m">{{ l.message }}</span>
    </div>
    <div v-if="rows.length === 0" class="empty small">暂无日志</div>
  </div>
</template>
