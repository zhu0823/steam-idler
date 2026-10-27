<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { fmtTime, live } from '../api';

// accountId 为空时显示全部账号的日志并标注账号名
const props = defineProps({ accountId: { type: String, default: null } });

const box = ref(null);
const logs = computed(() => (props.accountId ? live.logs.filter((l) => l.accountId === props.accountId) : live.logs));

watch(
  () => logs.value.length,
  async () => {
    const el = box.value;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    await nextTick();
    if (atBottom) el.scrollTop = el.scrollHeight;
  },
);
</script>

<template>
  <section class="card">
    <h2>运行日志</h2>
    <div ref="box" class="logs">
      <div v-for="(l, i) in logs" :key="i" class="log-line" :class="l.level">
        <span class="log-time">{{ fmtTime(l.time) }}</span>
        <span v-if="!accountId && l.accountName" class="log-account">{{ l.accountName }}</span>{{ l.message }}
      </div>
      <p v-if="logs.length === 0" class="muted">暂无日志</p>
    </div>
  </section>
</template>
