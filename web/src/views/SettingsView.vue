<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api, live } from '../api';

const form = reactive({
  maxConcurrent: 32,
  hoursUntilDrops: 2,
  checkIntervalMinutes: 15,
  personaState: 'online',
  machineName: '',
  skipAppIds: [],
});
const extraIds = ref('');
const saved = ref('');
const error = ref('');
const busy = ref(false);

// 徽章页中出现过的游戏可以直接勾选；其他 appid 手动填写
const knownGames = computed(() => [...(live.status?.games || [])].sort((a, b) => a.name.localeCompare(b.name)));
const knownIds = computed(() => new Set(knownGames.value.map((g) => g.appid)));

function load(config) {
  Object.assign(form, {
    maxConcurrent: config.maxConcurrent,
    hoursUntilDrops: config.hoursUntilDrops,
    checkIntervalMinutes: config.checkIntervalMinutes,
    personaState: config.personaState,
    machineName: config.machineName,
    skipAppIds: [...config.skipAppIds],
  });
  extraIds.value = config.skipAppIds.filter((id) => !knownIds.value.has(id)).join(', ');
}

function toggleSkip(appid, checked) {
  form.skipAppIds = checked ? [...form.skipAppIds, appid] : form.skipAppIds.filter((id) => id !== appid);
}

async function save() {
  error.value = '';
  saved.value = '';
  busy.value = true;
  const extra = extraIds.value.split(/[\s,，]+/).filter(Boolean).map(Number);
  if (extra.some((n) => !Number.isInteger(n) || n <= 0)) {
    error.value = '其他跳过的 AppID 只能填写正整数，用逗号分隔';
    busy.value = false;
    return;
  }
  try {
    const skipAppIds = [...form.skipAppIds.filter((id) => knownIds.value.has(id)), ...extra];
    load(await api('PUT', '/api/config', { ...form, skipAppIds }));
    saved.value = '已保存并生效';
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

// 修改面板密码
const pwd = reactive({ current: '', next: '', confirm: '' });
const pwdMsg = ref('');
const pwdErr = ref('');

async function changePassword() {
  pwdMsg.value = '';
  pwdErr.value = '';
  if (pwd.next !== pwd.confirm) {
    pwdErr.value = '两次输入的新密码不一致';
    return;
  }
  try {
    await api('POST', '/api/auth/password', { current: pwd.current, next: pwd.next });
    Object.assign(pwd, { current: '', next: '', confirm: '' });
    pwdMsg.value = '密码已修改，其他设备上的登录已失效';
  } catch (err) {
    pwdErr.value = err.message;
  }
}

onMounted(async () => {
  try {
    load(await api('GET', '/api/config'));
  } catch (err) {
    error.value = err.message;
  }
});
</script>

<template>
  <section class="card">
    <h2>挂卡设置</h2>
    <form class="form" @submit.prevent="save">
      <div class="grid">
        <label>
          同时挂的游戏数上限
          <input v-model.number="form.maxConcurrent" type="number" min="1" max="32" required />
          <span class="muted small">1–32，Steam 最多允许 32 个</span>
        </label>
        <label>
          单独挂的时长阈值（小时）
          <input v-model.number="form.hoursUntilDrops" type="number" min="0" max="100" step="0.5" required />
          <span class="muted small">未达到阈值的游戏同时挂；0 表示始终逐个挂</span>
        </label>
        <label>
          检查间隔（分钟）
          <input v-model.number="form.checkIntervalMinutes" type="number" min="5" max="1440" required />
          <span class="muted small">定时读取徽章页的间隔，最小 5 分钟</span>
        </label>
        <label>
          在线状态
          <select v-model="form.personaState">
            <option value="online">在线</option>
            <option value="invisible">隐身</option>
            <option value="offline">离线</option>
          </select>
        </label>
        <label>
          设备名称
          <input v-model="form.machineName" maxlength="64" required />
          <span class="muted small">显示在 Steam 授权设备列表中，下次登录 Steam 时生效</span>
        </label>
      </div>

      <fieldset>
        <legend>跳过的游戏</legend>
        <p v-if="knownGames.length === 0" class="muted small">登录 Steam 并完成一次检查后，这里会列出可掉卡的游戏。</p>
        <div v-else class="checklist">
          <label v-for="g in knownGames" :key="g.appid" class="check">
            <input type="checkbox" :checked="form.skipAppIds.includes(g.appid)" @change="toggleSkip(g.appid, $event.target.checked)" />
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
      <button class="primary" :disabled="busy">{{ busy ? '保存中…' : '保存设置' }}</button>
    </form>
  </section>

  <section class="card">
    <h2>修改面板密码</h2>
    <form class="form narrow-form" @submit.prevent="changePassword">
      <label>当前密码<input v-model="pwd.current" type="password" autocomplete="current-password" required /></label>
      <label>新密码（至少 8 位）<input v-model="pwd.next" type="password" autocomplete="new-password" minlength="8" required /></label>
      <label>确认新密码<input v-model="pwd.confirm" type="password" autocomplete="new-password" minlength="8" required /></label>
      <p v-if="pwdErr" class="alert error">{{ pwdErr }}</p>
      <p v-if="pwdMsg" class="alert ok">{{ pwdMsg }}</p>
      <button class="primary">修改密码</button>
    </form>
  </section>
</template>
