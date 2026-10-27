<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { api, live } from '../api';
import { extraIdsText, mergeSkipIds, parseIdList } from '../skip-ids.mjs';
import SettingsFields from './SettingsFields.vue';

const props = defineProps({ account: { type: Object, required: true } });

const customized = ref(false);
const form = reactive({});
const skipAppIds = ref([]);
const extraIds = ref('');
const saved = ref('');
const error = ref('');
const busy = ref(false);

const global = computed(() => live.status?.global || {});
const knownGames = computed(() => [...(props.account.games || [])].sort((a, b) => a.name.localeCompare(b.name)));
const knownIds = computed(() => new Set(knownGames.value.map((g) => g.appid)));

const PERSONA_TEXT = { online: '在线', invisible: '隐身', offline: '离线' };

function load(config) {
  customized.value = Boolean(config.customized);
  Object.assign(form, {
    maxConcurrent: config.maxConcurrent,
    hoursUntilDrops: config.hoursUntilDrops,
    checkIntervalMinutes: config.checkIntervalMinutes,
    personaState: config.personaState,
    machineName: config.machineName,
  });
  skipAppIds.value = [...config.skipAppIds];
  extraIds.value = extraIdsText(config.skipAppIds, knownIds.value);
}

load(props.account.config);

// 切换到其他账号时重新加载表单
watch(
  () => props.account.id,
  () => load(props.account.config),
);

// 游戏列表晚于配置加载时，把已出现在列表中的 AppID 从文本框移到复选框
watch(knownIds, (known) => {
  const { ids, valid } = parseIdList(extraIds.value);
  if (!valid) return;
  skipAppIds.value = [...new Set([...skipAppIds.value, ...ids])];
  extraIds.value = extraIdsText(ids, known);
});

function toggleSkip(appid, checked) {
  skipAppIds.value = checked ? [...skipAppIds.value, appid] : skipAppIds.value.filter((id) => id !== appid);
}

function enableCustom(on) {
  customized.value = on;
  // 开启覆盖时以当前全局值为起点
  if (on && !props.account.config.customized) Object.assign(form, global.value);
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
    const result = await api('PUT', `/api/accounts/${props.account.id}/config`, {
      skipAppIds: mergeSkipIds(skipAppIds.value, knownIds.value, extra.ids),
      overrides: customized.value ? { ...form } : null,
    });
    skipAppIds.value = [...result.skipAppIds];
    extraIds.value = extraIdsText(result.skipAppIds, knownIds.value);
    saved.value = '已保存并生效';
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="card">
    <h2>账号设置</h2>
    <form class="form" @submit.prevent="save">
      <fieldset>
        <legend>挂卡参数</legend>
        <label class="check">
          <input type="checkbox" :checked="customized" @change="enableCustom($event.target.checked)" />
          <span>为该账号单独设置（不勾选则使用“设置”页的全局默认值）</span>
        </label>
        <SettingsFields v-if="customized" :form="form" />
        <p v-else class="muted small">
          当前使用全局默认值：同时挂 {{ global.maxConcurrent }} 个，阈值 {{ global.hoursUntilDrops }} 小时，
          每 {{ global.checkIntervalMinutes }} 分钟检查，{{ PERSONA_TEXT[global.personaState] }}，设备名称 {{ global.machineName }}
        </p>
      </fieldset>

      <fieldset>
        <legend>跳过的游戏</legend>
        <p v-if="knownGames.length === 0" class="muted small">完成一次检查后，这里会列出该账号可掉卡的游戏。</p>
        <div v-else class="checklist">
          <label v-for="g in knownGames" :key="g.appid" class="check">
            <input type="checkbox" :checked="skipAppIds.includes(g.appid)" @change="toggleSkip(g.appid, $event.target.checked)" />
            <span>{{ g.name }} <span class="muted mono">{{ g.appid }}</span></span>
          </label>
        </div>
        <label>
          其他要跳过的 AppID
          <input v-model="extraIds" placeholder="例如：570, 730" spellcheck="false" />
        </label>
      </fieldset>

      <p v-if="error" class="alert error">{{ error }}</p>
      <p v-if="saved" class="alert ok">{{ saved }}</p>
      <button class="primary" :disabled="busy">{{ busy ? '保存中…' : '保存账号设置' }}</button>
    </form>
  </section>
</template>
