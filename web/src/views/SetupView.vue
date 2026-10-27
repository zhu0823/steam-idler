<script setup>
import { ref } from 'vue';
import { api } from '../api';

const emit = defineEmits(['done']);
const code = ref('');
const password = ref('');
const confirm = ref('');
const error = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  if (password.value !== confirm.value) {
    error.value = '两次输入的密码不一致';
    return;
  }
  busy.value = true;
  try {
    await api('POST', '/api/auth/setup', { code: code.value, password: password.value });
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
    <h1>初始化管理面板</h1>
    <p class="muted">首次使用需要输入初始化码并创建管理员密码。初始化码可通过以下任一方式获取：</p>
    <ul class="hint">
      <li>容器日志中 <code>SETUP CODE</code> 开头的一行，例如：<code>docker compose logs steam-idler | grep "SETUP CODE"</code></li>
      <li>NAS 的容器管理界面中查看该容器的日志</li>
      <li>数据目录下的 <code>data/setup_code</code> 文件</li>
    </ul>
    <form class="form" @submit.prevent="submit">
      <label>
        初始化码
        <input v-model="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX" required />
      </label>
      <label>
        管理员密码（至少 8 位）
        <input v-model="password" type="password" autocomplete="new-password" minlength="8" required />
      </label>
      <label>
        确认密码
        <input v-model="confirm" type="password" autocomplete="new-password" minlength="8" required />
      </label>
      <p v-if="error" class="alert error">{{ error }}</p>
      <button class="primary" :disabled="busy">{{ busy ? '提交中…' : '完成初始化' }}</button>
    </form>
  </section>
</template>
