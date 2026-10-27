<script setup>
import { computed, ref } from 'vue';
import { api, live } from '../api';

defineProps({
  title: { type: String, default: '添加 Steam 账号' },
  reason: { type: String, default: '' },
  hint: { type: String, default: '' },
});

const method = ref('qr');
const accountName = ref('');
const password = ref('');
const code = ref('');
const error = ref('');
const busy = ref(false);

const login = computed(() => live.login || { state: 'idle' });
const active = computed(() => login.value.method === method.value && login.value.state !== 'idle');

const codeLabel = computed(() =>
  login.value.codeType === 'email'
    ? `邮箱验证码${login.value.emailDomain ? `（发送至 @${login.value.emailDomain}）` : ''}`
    : '手机令牌验证码',
);

async function call(url, body) {
  error.value = '';
  busy.value = true;
  try {
    live.login = await api('POST', url, body);
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

const startQR = () => call('/api/steam/login/qr');

async function startCredentials() {
  await call('/api/steam/login/credentials', { accountName: accountName.value, password: password.value });
  password.value = '';
}

async function submitCode() {
  await call('/api/steam/login/code', { code: code.value });
  code.value = '';
}

const cancel = () => call('/api/steam/login/cancel');

function switchMethod(m) {
  if (method.value === m) return;
  if (login.value.state !== 'idle' && login.value.state !== 'authenticated') cancel();
  method.value = m;
}
</script>

<template>
  <section class="card">
    <h2>{{ title }}</h2>
    <p v-if="reason" class="alert warn">{{ reason }}</p>
    <p v-if="hint" class="muted small">{{ hint }}</p>

    <div class="segmented">
      <button :class="{ active: method === 'qr' }" @click="switchMethod('qr')">扫码登录（推荐）</button>
      <button :class="{ active: method === 'password' }" @click="switchMethod('password')">账号密码</button>
    </div>

    <p v-if="error" class="alert error">{{ error }}</p>
    <p v-if="active && login.state === 'failed'" class="alert error">{{ login.error }}</p>
    <p v-if="active && login.state === 'authenticated'" class="alert ok">登录成功，正在连接 Steam…</p>

    <!-- 扫码登录 -->
    <div v-if="method === 'qr'" class="login-body">
      <template v-if="active && (login.state === 'waiting_scan' || login.state === 'scanned')">
        <div class="qr" v-html="login.qrSvg"></div>
        <p v-if="login.state === 'waiting_scan'" class="muted">打开 Steam 手机 App，点击右上角盾牌图标，选择“扫描二维码”。</p>
        <p v-else class="alert ok">已扫码，请在手机上确认登录。</p>
        <button @click="cancel">取消</button>
      </template>
      <template v-else>
        <p class="muted">扫码登录不需要在网页上输入 Steam 密码。</p>
        <button class="primary" :disabled="busy" @click="startQR">{{ busy ? '生成中…' : '生成二维码' }}</button>
      </template>
    </div>

    <!-- 账号密码登录 -->
    <div v-else class="login-body">
      <form v-if="active && login.state === 'need_code'" class="form" @submit.prevent="submitCode">
        <label>
          {{ codeLabel }}
          <input v-model="code" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required autofocus />
        </label>
        <p v-if="login.codeType === 'device'" class="muted small">也可以直接在 Steam 手机 App 中点击确认。</p>
        <p v-if="login.error" class="alert error">{{ login.error }}</p>
        <div class="row">
          <button class="primary" :disabled="busy">提交</button>
          <button type="button" @click="cancel">取消</button>
        </div>
      </form>
      <template v-else-if="active && login.state === 'authenticating'">
        <p class="alert ok">验证已通过，正在登录 Steam…</p>
        <button @click="cancel">取消</button>
      </template>
      <template v-else-if="active && login.state === 'need_confirm'">
        <p class="alert ok">{{ login.codeType === 'email' ? '请打开 Steam 发送的确认邮件并点击确认链接。' : '请在 Steam 手机 App 中确认本次登录。' }}</p>
        <button @click="cancel">取消</button>
      </template>
      <form v-else class="form" @submit.prevent="startCredentials">
        <label>
          Steam 账号
          <input v-model="accountName" autocomplete="username" spellcheck="false" required />
        </label>
        <label>
          密码
          <input v-model="password" type="password" autocomplete="current-password" required />
        </label>
        <p class="muted small">密码仅用于本次登录，不会保存。通过公网访问面板时请使用 HTTPS。</p>
        <button class="primary" :disabled="busy">{{ busy ? '登录中…' : '登录' }}</button>
      </form>
    </div>
  </section>
</template>
