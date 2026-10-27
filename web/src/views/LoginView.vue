<script setup>
import { ref } from 'vue';
import { api } from '../api';

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
  <section class="card narrow">
    <h1>登录管理面板</h1>
    <form class="form" @submit.prevent="submit">
      <label>
        管理员密码
        <input v-model="password" type="password" autocomplete="current-password" required autofocus />
      </label>
      <p v-if="error" class="alert error">{{ error }}</p>
      <button class="primary" :disabled="busy">{{ busy ? '登录中…' : '登录' }}</button>
    </form>
    <p class="muted small">忘记密码：删除 <code>data/admin.json</code> 并重启容器，再用新的初始化码重新设置。Steam 登录状态和挂卡配置不受影响。</p>
  </section>
</template>
