<script setup>
import { ref } from 'vue';
import { api } from '../api';
import Icon from '../components/Icon.vue';

const emit = defineEmits(['done']);
const code = ref('');
const password = ref('');
const confirm = ref('');
const where = ref('cli');
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
  <div class="auth-wrap">
    <form class="card auth-card" @submit.prevent="submit">
      <div class="brand">
        <span class="brand-mark"><Icon name="logo" /></span>
        <div>
          <div class="brand-name">Steam Idler</div>
          <div class="brand-sub">首次使用</div>
        </div>
      </div>
      <div>
        <h1 class="auth-title">初始化管理面板</h1>
        <p class="page-sub">输入启动日志中的初始化码，并创建管理员密码</p>
      </div>

      <div class="field">
        <label for="s-code">初始化码</label>
        <input id="s-code" v-model="code" class="input code-input" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX" required />
        <span class="hint">不区分大小写，横线可省略</span>
      </div>

      <div class="stack" style="gap: 8px">
        <div class="pill-tabs">
          <button type="button" :class="{ on: where === 'cli' }" @click="where = 'cli'">命令行</button>
          <button type="button" :class="{ on: where === 'nas' }" @click="where = 'nas'">NAS 界面</button>
          <button type="button" :class="{ on: where === 'file' }" @click="where = 'file'">文件</button>
        </div>
        <div v-if="where === 'cli'" class="snippet mono">docker compose logs steam-idler | grep "SETUP CODE"</div>
        <div v-else-if="where === 'nas'" class="snippet">容器管理 → steam-idler → 日志，查找以 <b>SETUP CODE</b> 开头的一行</div>
        <div v-else class="snippet mono">data/setup_code</div>
      </div>

      <div class="divider"></div>

      <div class="field">
        <label for="s-pass">管理员密码</label>
        <input id="s-pass" v-model="password" class="input" type="password" autocomplete="new-password" minlength="8" placeholder="至少 8 位" required />
      </div>
      <div class="field">
        <label for="s-confirm">确认密码</label>
        <input id="s-confirm" v-model="confirm" class="input" type="password" autocomplete="new-password" minlength="8" required />
      </div>

      <p v-if="error" class="callout err"><Icon name="alert" />{{ error }}</p>
      <button class="btn primary lg" :disabled="busy">{{ busy ? '提交中…' : '完成初始化' }}</button>
      <p class="foot-note">初始化完成后初始化码立即失效</p>
    </form>
  </div>
</template>
