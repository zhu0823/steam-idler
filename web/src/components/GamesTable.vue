<script setup>
import { computed, ref } from 'vue';
import { api, fmtDate } from '../api';
import DropPips from './DropPips.vue';
import Icon from './Icon.vue';

const props = defineProps({ account: { type: Object, required: true } });

const query = ref('');
const filter = ref('all');
const saving = ref(new Set());
const error = ref('');

const threshold = computed(() => props.account.config.hoursUntilDrops);
const playingIds = computed(() => new Set(props.account.playing.map((g) => g.appid)));
const manualSkip = computed(() => new Set(props.account.config.skipAppIds));

function statusOf(g) {
  if (g.skipped) return 'skipped';
  if (playingIds.value.has(g.appid)) return 'playing';
  if (props.account.config.priorityOnly && !g.priority) return 'waiting';
  return 'queued';
}

const rows = computed(() => {
  const q = query.value.trim().toLowerCase();
  const rank = { playing: 0, queued: 1, waiting: 2, skipped: 3 };
  return props.account.games
    .filter((g) => !q || g.name.toLowerCase().includes(q) || String(g.appid).includes(q))
    .filter((g) => filter.value === 'all' || (filter.value === 'priority' ? g.priority : statusOf(g) === filter.value))
    .sort(
      (a, b) =>
        rank[statusOf(a)] - rank[statusOf(b)] || (a.priority || Infinity) - (b.priority || Infinity) || b.hours - a.hours,
    );
});

async function saveList(g, patch) {
  error.value = '';
  saving.value = new Set([...saving.value, g.appid]);
  try {
    await api('PUT', `/api/accounts/${props.account.id}/config`, patch);
  } catch (err) {
    error.value = err.message;
  } finally {
    const next = new Set(saving.value);
    next.delete(g.appid);
    saving.value = next;
  }
}

// 勾选“跳过”立即保存（保留配置中不在当前列表里的 AppID）
function toggleSkip(g, skip) {
  const current = new Set(props.account.config.skipAppIds);
  if (skip) current.add(g.appid);
  else current.delete(g.appid);
  return saveList(g, { skipAppIds: [...current] });
}

// 星标加入或移出优先队列，新加入的排在队尾
function togglePriority(g) {
  const list = props.account.config.priorityAppIds;
  return saveList(g, { priorityAppIds: g.priority ? list.filter((id) => id !== g.appid) : [...list, g.appid] });
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
        <option value="priority">优先队列</option>
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
              <div class="game-cell">
                <button
                  class="star-toggle"
                  :class="{ on: g.priority }"
                  :disabled="saving.has(g.appid)"
                  :title="g.priority ? `优先队列第 ${g.priority} 位，点击移出` : '加入优先队列'"
                  :aria-label="g.priority ? '移出优先队列' : '加入优先队列'"
                  @click="togglePriority(g)"
                >
                  <Icon :name="g.priority ? 'starFill' : 'star'" />
                </button>
                <div>
                  <div class="game-name">{{ g.name }}</div>
                  <div class="game-id mono">{{ g.appid }}</div>
                </div>
              </div>
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
              <span v-else-if="g.skipReason === 'refundable'" class="chip warn" :title="`退款截止 ${fmtDate(g.refundableUntil)}，之后自动开始挂卡`">
                退款期至 {{ fmtDate(g.refundableUntil) }}
              </span>
              <span v-else-if="g.skipReason === 'unplayed'" class="chip plain">未玩过</span>
              <span v-else-if="statusOf(g) === 'skipped'" class="chip plain">已跳过</span>
              <span v-else-if="statusOf(g) === 'waiting'" class="chip plain" title="已开启只挂优先队列">不在队列</span>
              <span v-else-if="g.priority" class="chip accent">优先 #{{ g.priority }}</span>
              <span v-else class="chip plain">排队</span>
            </td>
            <td class="r">
              <input
                type="checkbox"
                class="skip-toggle"
                :checked="manualSkip.has(g.appid)"
                :disabled="saving.has(g.appid)"
                :title="manualSkip.has(g.appid) ? '取消跳过' : '跳过该游戏'"
                @change="toggleSkip(g, $event.target.checked)"
              />
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="card-pad small muted" style="border-top: 1px solid var(--border)">
      显示 {{ rows.length }} / {{ account.games.length }} 个游戏 · 星标加入优先队列、勾选“跳过”后立即生效
    </div>
  </template>
</template>
