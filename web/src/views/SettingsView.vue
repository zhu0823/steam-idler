<script setup>
import { onMounted, reactive, ref } from 'vue';
import { api } from '../api';
import SettingsFields from '../components/SettingsFields.vue';

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

async function save() {
  error.value = '';
  saved.value = '';
  busy.value = true;
  try {
    Object.assign(form, await api('PUT', '/api/config', { ...form }));
    saved.value = '已保存，未单独设置参数的账号立即生效';
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
  <section class="card">
    <h2>全局默认挂卡参数</h2>
    <p class="muted small">所有账号默认使用这里的参数；需要不同参数的账号可以在账号详情页单独设置。跳过的游戏在各账号详情页设置。</p>
    <form class="form" @submit.prevent="save">
      <SettingsFields :form="form" />
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
