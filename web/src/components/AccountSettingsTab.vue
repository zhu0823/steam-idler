<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { api, live, FARMING_ORDER_TEXT } from '../api';
import { extraIdsText, mergeSkipIds, parseIdList } from '../skip-ids.mjs';
import SettingsFields from './SettingsFields.vue';
import Icon from './Icon.vue';

const props = defineProps({ account: { type: Object, required: true } });

const PERSONA_TEXT = { online: '在线', invisible: '隐身', offline: '离线' };
const SETTING_KEYS = [
  'maxConcurrent',
  'hoursUntilDrops',
  'checkIntervalMinutes',
  'personaState',
  'machineName',
  'farmingOrder',
  'skipRefundable',
  'skipUnplayed',
  'farmingStatusText',
  'idleStatusText',
];
const MAX_IDLE_GAMES = 32;

const global = computed(() => live.status?.global || {});
const knownIds = computed(() => new Set(props.account.games.map((g) => g.appid)));
const gameNames = computed(() => new Map(props.account.games.map((g) => [g.appid, g.name])));

const customized = ref(false);
const form = reactive({});
const extraIds = ref('');
const idleIds = ref('');
const queue = ref([]);
const priorityOnly = ref(false);
const saved = ref('');
const error = ref('');
const busy = ref(false);

function load() {
  const c = props.account.config;
  customized.value = Boolean(c.customized);
  Object.assign(form, Object.fromEntries(SETTING_KEYS.map((k) => [k, c[k]])));
  // 游戏列表中的 AppID 在“游戏”页签里勾选，这里只编辑列表之外的
  extraIds.value = extraIdsText(c.skipAppIds, knownIds.value);
  idleIds.value = c.idleAppIds.join(', ');
  queue.value = [...c.priorityAppIds];
  priorityOnly.value = Boolean(c.priorityOnly);
}

load();
watch(() => props.account.id, load);

function toggleCustom() {
  customized.value = !customized.value;
  // 开启覆盖时以当前全局值为起点
  if (customized.value && !props.account.config.customized) {
    Object.assign(form, Object.fromEntries(SETTING_KEYS.map((k) => [k, global.value[k]])));
  }
}

function move(i, delta) {
  const list = [...queue.value];
  const [id] = list.splice(i, 1);
  list.splice(i + delta, 0, id);
  queue.value = list;
}

function removeQueued(i) {
  queue.value = queue.value.filter((_, j) => j !== i);
}

async function save() {
  error.value = '';
  saved.value = '';
  const extra = parseIdList(extraIds.value);
  const idle = parseIdList(idleIds.value);
  if (!extra.valid || !idle.valid) {
    error.value = 'AppID 只能填写正整数，用逗号分隔';
    return;
  }
  if (new Set(idle.ids).size > MAX_IDLE_GAMES) {
    error.value = `掉完后挂的游戏最多 ${MAX_IDLE_GAMES} 个`;
    return;
  }
  busy.value = true;
  try {
    await api('PUT', `/api/accounts/${props.account.id}/config`, {
      skipAppIds: mergeSkipIds(props.account.config.skipAppIds, knownIds.value, extra.ids),
      priorityAppIds: queue.value,
      priorityOnly: priorityOnly.value,
      idleAppIds: idle.ids,
      overrides: customized.value ? { ...form } : null,
    });
    saved.value = '已保存并生效';
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="card-pad stack" @submit.prevent="save">
    <div class="setting-row">
      <div>
        <div class="t">为该账号单独设置挂卡参数</div>
        <div class="d">关闭时使用“全局设置”中的默认值，全局修改会同步到该账号</div>
      </div>
      <button type="button" class="switch" :class="{ on: customized }" role="switch" :aria-checked="customized" @click="toggleCustom"></button>
    </div>

    <SettingsFields v-if="customized" :form="form" />
    <div v-else class="inherit">
      <div><div class="k">同时挂上限</div><div class="v">{{ global.maxConcurrent }} 个</div></div>
      <div><div class="k">单独挂阈值</div><div class="v">{{ global.hoursUntilDrops }} 小时</div></div>
      <div><div class="k">检查间隔</div><div class="v">{{ global.checkIntervalMinutes }} 分钟</div></div>
      <div><div class="k">在线状态</div><div class="v">{{ PERSONA_TEXT[global.personaState] }}</div></div>
      <div><div class="k">设备名称</div><div class="v mono" style="font-size: 13px">{{ global.machineName }}</div></div>
      <div><div class="k">挂卡顺序</div><div class="v">{{ FARMING_ORDER_TEXT[global.farmingOrder] }}</div></div>
      <div><div class="k">退款期内的游戏</div><div class="v">{{ global.skipRefundable ? '跳过' : '照常挂' }}</div></div>
      <div><div class="k">从未玩过的游戏</div><div class="v">{{ global.skipUnplayed ? '跳过' : '照常挂' }}</div></div>
      <div><div class="k">挂卡时状态文本</div><div class="v" :title="global.farmingStatusText">{{ global.farmingStatusText || '不显示' }}</div></div>
      <div><div class="k">掉完后状态文本</div><div class="v" :title="global.idleStatusText">{{ global.idleStatusText || '不显示' }}</div></div>
    </div>

    <div class="divider"></div>

    <div class="field">
      <label>优先队列</label>
      <div v-if="queue.length" class="queue">
        <div v-for="(id, i) in queue" :key="id" class="queue-item">
          <span class="rank num">#{{ i + 1 }}</span>
          <span class="name">{{ gameNames.get(id) || '已掉完或不在徽章页' }} <span class="muted mono small">{{ id }}</span></span>
          <button type="button" class="star-toggle" title="上移" :disabled="i === 0" @click="move(i, -1)"><Icon name="up" /></button>
          <button type="button" class="star-toggle" title="下移" :disabled="i === queue.length - 1" @click="move(i, 1)"><Icon name="down" /></button>
          <button type="button" class="star-toggle" title="移出队列" @click="removeQueued(i)"><Icon name="close" /></button>
        </div>
      </div>
      <span class="hint">{{ queue.length ? '队列中的游戏按顺序先挂，全部掉完后才挂其他游戏' : '在“游戏”页签点击星标把游戏加入优先队列，队列中的游戏会最先挂' }}</span>
    </div>

    <div class="setting-row">
      <div>
        <div class="t">只挂优先队列中的游戏</div>
        <div class="d">队列为空或全部掉完后不再挂其他游戏</div>
      </div>
      <button type="button" class="switch" :class="{ on: priorityOnly }" role="switch" :aria-checked="priorityOnly" @click="priorityOnly = !priorityOnly"></button>
    </div>

    <div class="field">
      <label for="f-idle">卡片掉完后挂的游戏</label>
      <input id="f-idle" v-model="idleIds" class="input mono" placeholder="AppID，例如：440, 570" spellcheck="false" />
      <span class="hint">没有可挂卡的游戏时挂这些游戏累计时长，最多 32 个（设置了掉完后状态文本时只取前 31 个）；需要账号拥有这些游戏</span>
    </div>

    <div class="field">
      <label for="f-extra">其他要跳过的 AppID</label>
      <input id="f-extra" v-model="extraIds" class="input mono" placeholder="例如：570, 730" spellcheck="false" />
      <span class="hint">游戏列表中的游戏直接在“游戏”页签勾选跳过；这里填写暂未出现在列表中的游戏</span>
    </div>

    <p v-if="error" class="callout err"><Icon name="alert" />{{ error }}</p>
    <p v-if="saved" class="callout ok">{{ saved }}</p>
    <div class="row end"><button class="btn primary" :disabled="busy">{{ busy ? '保存中…' : '保存账号设置' }}</button></div>
  </form>
</template>
