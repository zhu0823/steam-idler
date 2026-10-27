<script setup>
import { computed, ref } from 'vue';
import { api } from '../api';
import DropPips from './DropPips.vue';
import Icon from './Icon.vue';

const props = defineProps({ account: { type: Object, required: true } });

const query = ref('');
const filter = ref('all');
const saving = ref(new Set());
const error = ref('');

const threshold = computed(() => props.account.config.hoursUntilDrops);
const playingIds = computed(() => new Set(props.account.playing.map((g) => g.appid)));

function statusOf(g) {
  if (g.skipped) return 'skipped';
  return playingIds.value.has(g.appid) ? 'playing' : 'queued';
}

const rows = computed(() => {
  const q = query.value.trim().toLowerCase();
  const rank = { playing: 0, queued: 1, skipped: 2 };
  return props.account.games
    .filter((g) => !q || g.name.toLowerCase().includes(q) || String(g.appid).includes(q))
    .filter((g) => filter.value === 'all' || statusOf(g) === filter.value)
    .sort((a, b) => rank[statusOf(a)] - rank[statusOf(b)] || b.hours - a.hours);
});

// 勾选“跳过”立即保存（保留配置中不在当前列表里的 AppID）
async function toggleSkip(g, skip) {
  error.value = '';
  const current = new Set(props.account.config.skipAppIds);
  if (skip) current.add(g.appid);
  else current.delete(g.appid);
  saving.value = new Set([...saving.value, g.appid]);
  try {
    await api('PUT', `/api/accounts/${props.account.id}/config`, { skipAppIds: [...current] });
  } catch (err) {
    error.value = err.message;
  } finally {
    const next = new Set(saving.value);
    next.delete(g.appid);
    saving.value = next;
  }
}
</script>

<template>
  <div v-if="!account.lastCheckAt" class="empty small">
    {{ account.state === 'auth_failed' ? '重新登录后会自动读取徽章页。' : '登录完成后会自动读取徽章页。' }}
  </div>
  <div v-else-if="account.games.length === 0" class="empty small">没有可掉卡的游戏，程序会继续定期检查。</div>
  <template v-else>
    <div class="table-tools">
      <label class="search"><Icon name="search" /><input v-model="query" class="input" placeholder="搜索游戏或 AppID" /></label>
      <select v-model="filter" class="select">
        <option value="all">全部状态</option>
        <option value="playing">挂卡中</option>
        <option value="queued">排队</option>
        <option value="skipped">已跳过</option>
      </select>
    </div>
    <p v-if="error" class="callout err" style="margin: 12px 20px 0"><Icon name="alert" />{{ error }}</p>
    <div style="overflow-x: auto">
      <table class="table">
        <thead>
          <tr>
            <th>游戏</th>
            <th class="hide-sm">游玩时长</th>
            <th>剩余掉落</th>
            <th>状态</th>
            <th class="r">跳过</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="g in rows" :key="g.appid">
            <td>
              <div class="game-name">{{ g.name }}</div>
              <div class="game-id mono">{{ g.appid }}</div>
            </td>
            <td class="hide-sm">
              <div class="hours">
                <span class="num">{{ g.hours }}h {{ threshold > 0 && g.hours >= threshold ? '· 可掉卡' : threshold > 0 ? `/ ${threshold}h` : '' }}</span>
                <div class="bar" :class="{ ok: threshold <= 0 || g.hours >= threshold }">
                  <i :style="{ width: `${threshold > 0 ? Math.min(g.hours / threshold, 1) * 100 : 100}%` }"></i>
                </div>
              </div>
            </td>
            <td class="num"><DropPips :count="g.drops" /><span class="drop-text" style="margin-left: 8px">{{ g.drops }}</span></td>
            <td>
              <span v-if="statusOf(g) === 'playing'" class="chip ok">挂卡中</span>
              <span v-else-if="statusOf(g) === 'skipped'" class="chip plain">已跳过</span>
              <span v-else class="chip plain">排队</span>
            </td>
            <td class="r">
              <input
                type="checkbox"
                class="skip-toggle"
                :checked="g.skipped"
                :disabled="saving.has(g.appid)"
                :title="g.skipped ? '取消跳过' : '跳过该游戏'"
                @change="toggleSkip(g, $event.target.checked)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="card-pad small muted" style="border-top: 1px solid var(--border)">
      显示 {{ rows.length }} / {{ account.games.length }} 个游戏 · 勾选“跳过”后立即生效
    </div>
  </template>
</template>
