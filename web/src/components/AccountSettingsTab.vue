<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { api, live } from '../api';
import { extraIdsText, mergeSkipIds, parseIdList } from '../skip-ids.mjs';
import SettingsFields from './SettingsFields.vue';
import Icon from './Icon.vue';

const props = defineProps({ account: { type: Object, required: true } });

const PERSONA_TEXT = { online: '在线', invisible: '隐身', offline: '离线' };
const global = computed(() => live.status?.global || {});
const knownIds = computed(() => new Set(props.account.games.map((g) => g.appid)));

const customized = ref(false);
const form = reactive({});
const extraIds = ref('');
const saved = ref('');
const error = ref('');
const busy = ref(false);

function load() {
  const c = props.account.config;
  customized.value = Boolean(c.customized);
  Object.assign(form, {
    maxConcurrent: c.maxConcurrent,
    hoursUntilDrops: c.hoursUntilDrops,
    checkIntervalMinutes: c.checkIntervalMinutes,
    personaState: c.personaState,
    machineName: c.machineName,
  });
  // 游戏列表中的 AppID 在“游戏”页签里勾选，这里只编辑列表之外的
  extraIds.value = extraIdsText(c.skipAppIds, knownIds.value);
}

load();
watch(() => props.account.id, load);

function toggleCustom() {
  customized.value = !customized.value;
  // 开启覆盖时以当前全局值为起点
  if (customized.value && !props.account.config.customized) Object.assign(form, global.value);
}

async function save() {
  error.value = '';
  saved.value = '';
  const extra = parseIdList(extraIds.value);
  if (!extra.valid) {
    error.value = '其他跳过的 AppID 只能填写正整数，用逗号分隔';
    return;
  }
  busy.value = true;
  try {
    await api('PUT', `/api/accounts/${props.account.id}/config`, {
      skipAppIds: mergeSkipIds(props.account.config.skipAppIds, knownIds.value, extra.ids),
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
    </div>

    <div class="divider"></div>

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
