<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { api, live } from '../api';
import SettingsFields from '../components/SettingsFields.vue';
import Icon from '../components/Icon.vue';

const form = reactive({
  maxConcurrent: 32,
  hoursUntilDrops: 2,
  checkIntervalMinutes: 15,
  personaState: 'online',
  machineName: '',
});
const saved = ref('');
const error = ref('');
const busy = ref(false);
const usingGlobal = computed(() => (live.status?.accounts || []).filter((a) => !a.config.customized).length);

async function save() {
  error.value = '';
  saved.value = '';
  busy.value = true;
  try {
    Object.assign(form, await api('PUT', '/api/config', { ...form }));
    saved.value = '已保存，使用全局默认的账号立即生效';
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
    Object.assign(form, await api('GET', '/api/config'));
  } catch (err) {
    error.value = err.message;
  }
});
</script>

<template>
  <div class="page-head">
    <div>
      <h1 class="page-title">全局设置</h1>
      <p class="page-sub">所有账号默认使用这些参数；单独设置过的账号不受影响</p>
    </div>
  </div>

  <form class="card card-pad stack" @submit.prevent="save">
    <div class="card-title">默认挂卡参数 <small>{{ usingGlobal }} 个账号使用全局默认</small></div>
    <SettingsFields :form="form" />
    <div class="callout info">
      <Icon name="info" />
      <div>
        挂卡分两个阶段：未满阈值的游戏<b>同时挂</b>累计时长（约 2 小时内不掉卡），满阈值后<b>逐个单独挂</b>掉卡。账号没有 2 小时限制时可把阈值设为 0。
      </div>
    </div>
    <p v-if="error" class="callout err"><Icon name="alert" />{{ error }}</p>
    <p v-if="saved" class="callout ok">{{ saved }}</p>
    <div class="row end"><button class="btn primary" :disabled="busy">{{ busy ? '保存中…' : '保存设置' }}</button></div>
  </form>

  <form class="card card-pad stack" @submit.prevent="changePassword">
    <div class="card-title">面板密码 <small>修改后其他设备的登录立即失效</small></div>
    <div class="form-grid">
      <div class="field full">
        <label for="p-cur">当前密码</label>
        <input id="p-cur" v-model="pwd.current" class="input" type="password" autocomplete="current-password" required />
      </div>
      <div class="field">
        <label for="p-new">新密码</label>
        <input id="p-new" v-model="pwd.next" class="input" type="password" autocomplete="new-password" minlength="8" placeholder="至少 8 位" required />
      </div>
      <div class="field">
        <label for="p-confirm">确认新密码</label>
        <input id="p-confirm" v-model="pwd.confirm" class="input" type="password" autocomplete="new-password" minlength="8" required />
      </div>
    </div>
    <p v-if="pwdErr" class="callout err"><Icon name="alert" />{{ pwdErr }}</p>
    <p v-if="pwdMsg" class="callout ok">{{ pwdMsg }}</p>
    <div class="row end"><button class="btn">修改密码</button></div>
  </form>
</template>
