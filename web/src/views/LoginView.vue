<script setup>
import { ref } from 'vue';
import { api } from '../api';
import Icon from '../components/Icon.vue';

const emit = defineEmits(['done']);
const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  busy.value = true;
  try {
    await api('POST', '/api/auth/login', { password: password.value });
    password.value = '';
    emit('done');
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <form class="card auth-card" @submit.prevent="submit">
      <div class="brand">
        <span class="brand-mark"><Icon name="logo" /></span>
        <div>
          <div class="brand-name">Steam Idler</div>
          <div class="brand-sub">管理面板</div>
        </div>
      </div>
      <div>
        <h1 class="auth-title">登录</h1>
        <p class="page-sub">输入管理员密码</p>
      </div>
      <div class="field">
        <label for="l-pass">管理员密码</label>
        <input id="l-pass" v-model="password" class="input" type="password" autocomplete="current-password" required autofocus />
      </div>
      <p v-if="error" class="callout err"><Icon name="alert" />{{ error }}</p>
      <button class="btn primary lg" :disabled="busy">{{ busy ? '登录中…' : '登录' }}</button>
      <p class="foot-note">
        忘记密码：删除 <span class="mono">data/admin.json</span> 并重启容器，用新的初始化码重新设置。账号和挂卡不受影响。
      </p>
    </form>
  </div>
</template>
