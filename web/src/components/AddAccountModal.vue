<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { api, live } from '../api';
import { ui } from '../ui';
import Icon from './Icon.vue';

const method = ref('qr');
const accountName = ref('');
const password = ref('');
const code = ref('');
const error = ref('');
const busy = ref(false);
const now = ref(Date.now());
let timer = null;

const login = computed(() => live.login || { state: 'idle' });
const active = computed(() => login.value.method === method.value && login.value.state !== 'idle');
const state = computed(() => (active.value ? login.value.state : 'idle'));
const title = computed(() => (ui.relogin ? `重新登录 ${ui.relogin}` : '添加 Steam 账号'));

const remaining = computed(() => {
  if (!login.value.expiresAt) return '';
  const s = Math.max(0, Math.round((new Date(login.value.expiresAt).getTime() - now.value) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
});

const codeLabel = computed(() =>
  login.value.codeType === 'email'
    ? `邮箱验证码${login.value.emailDomain ? `（发送至 @${login.value.emailDomain}）` : ''}`
    : '手机令牌验证码',
);

// 扫码步骤：1 生成二维码 → 2 扫码 → 3 手机确认
const qrStep = computed(() => {
  if (state.value === 'waiting_scan') return 2;
  if (state.value === 'scanned' || state.value === 'authenticating') return 3;
  if (state.value === 'authenticated') return 4;
  return 1;
});

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

async function cancelFlow() {
  if (login.value.state !== 'idle' && login.value.state !== 'authenticated' && login.value.state !== 'failed') {
    await call('/api/steam/login/cancel');
  }
}

async function switchMethod(m) {
  if (method.value === m) return;
  await cancelFlow();
  method.value = m;
  if (m === 'qr') startQR();
}

async function close() {
  await cancelFlow();
  ui.addOpen = false;
}

// 登录成功后稍作停留再关闭
watch(state, (s) => {
  if (s === 'authenticated') setTimeout(() => (ui.addOpen = false), 1500);
});

function onKey(e) {
  if (e.key === 'Escape') close();
}

onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 1000);
  window.addEventListener('keydown', onKey);
  // 打开即生成二维码
  if (!['waiting_scan', 'scanned'].includes(login.value.state)) startQR();
});

onUnmounted(() => {
  clearInterval(timer);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div class="overlay" @click.self="close">
    <section class="card modal" role="dialog" aria-modal="true" :aria-label="title">
      <div class="modal-head">
        <div>
          <div class="card-title" style="font-size: 16px">{{ title }}</div>
          <p class="page-sub">{{ ui.relogin ? `请使用 ${ui.relogin} 登录；登录其他账号会作为新账号添加` : '每个账号独立挂卡，可随时在详情页移除' }}</p>
        </div>
        <button class="btn ghost sm icon-only" aria-label="关闭" @click="close"><Icon name="close" /></button>
      </div>

      <div class="seg">
        <button :class="{ on: method === 'qr' }" @click="switchMethod('qr')">扫码登录（推荐）</button>
        <button :class="{ on: method === 'password' }" @click="switchMethod('password')">账号密码</button>
      </div>

      <div class="modal-body stack">
        <p v-if="error" class="callout err"><Icon name="alert" />{{ error }}</p>
        <p v-if="state === 'failed'" class="callout err"><Icon name="alert" />{{ login.error }}</p>
        <p v-if="state === 'authenticated'" class="callout ok">登录成功，正在连接 Steam 并开始挂卡…</p>

        <!-- 扫码登录 -->
        <div v-if="method === 'qr'" class="qr-layout">
          <!-- 二维码 SVG 由后端 qrcode 库生成 -->
          <div v-if="state === 'waiting_scan' || state === 'scanned'" class="qr" v-html="login.qrSvg"></div>
          <div v-else class="qr">
            <template v-if="busy">正在生成二维码…</template>
            <button v-else class="btn primary" @click="startQR"><Icon name="refresh" />{{ state === 'failed' ? '重新生成' : '生成二维码' }}</button>
          </div>
          <div class="stack" style="gap: 14px">
            <ol class="steps">
              <li :class="qrStep > 1 ? 'done' : 'cur'"><i>{{ qrStep > 1 ? '✓' : '1' }}</i><span>生成登录二维码</span></li>
              <li :class="qrStep > 2 ? 'done' : qrStep === 2 ? 'cur' : ''">
                <i>{{ qrStep > 2 ? '✓' : '2' }}</i><span>打开 Steam 手机 App，点右上角<b style="color: var(--text)">盾牌图标 → 扫描二维码</b></span>
              </li>
              <li :class="qrStep > 3 ? 'done' : qrStep === 3 ? 'cur' : ''">
                <i>{{ qrStep > 3 ? '✓' : '3' }}</i><span>在手机上确认登录，账号会自动加入列表并开始挂卡</span>
              </li>
            </ol>
            <div v-if="state === 'waiting_scan' || state === 'scanned'" class="timer">
              <span class="chip accent plain">{{ state === 'scanned' ? '已扫码，等待确认' : '等待扫码' }}</span>{{ remaining }} 后过期
            </div>
            <div class="callout info small">
              <Icon name="info" />
              <div>扫码登录不经过网页输入密码。登录已存在的账号会更新它的凭据，不会重复添加。</div>
            </div>
          </div>
        </div>

        <!-- 账号密码登录 -->
        <template v-else>
          <form v-if="state === 'need_code'" class="stack" @submit.prevent="submitCode">
            <div class="field">
              <label for="m-code">{{ codeLabel }}</label>
              <input id="m-code" v-model="code" class="input mono code-input" style="height: 44px; font-size: 18px" autocomplete="one-time-code" autocapitalize="characters" spellcheck="false" required />
              <span v-if="login.codeType === 'device'" class="hint">也可以直接在 Steam 手机 App 中点确认</span>
            </div>
            <p v-if="login.error" class="callout err"><Icon name="alert" />{{ login.error }}</p>
            <div class="row end">
              <button type="button" class="btn" @click="cancelFlow">取消</button>
              <button class="btn primary" :disabled="busy">提交验证码</button>
            </div>
          </form>
          <div v-else-if="state === 'need_confirm'" class="callout info">
            <Icon name="info" />
            <div>{{ login.codeType === 'email' ? '请打开 Steam 发送的确认邮件并点击确认链接。' : '请在 Steam 手机 App 中确认本次登录。' }}</div>
          </div>
          <div v-else-if="state === 'authenticating'" class="callout info"><Icon name="refresh" />验证已通过，正在登录 Steam…</div>
          <form v-else-if="state !== 'authenticated'" class="stack" @submit.prevent="startCredentials">
            <div class="field">
              <label for="m-user">Steam 账号</label>
              <input id="m-user" v-model="accountName" class="input" autocomplete="username" spellcheck="false" placeholder="登录名，不是昵称" required />
            </div>
            <div class="field">
              <label for="m-pass">密码</label>
              <input id="m-pass" v-model="password" class="input" type="password" autocomplete="current-password" required />
              <span class="hint">仅用于本次登录，不会保存；通过公网访问面板时请使用 HTTPS</span>
            </div>
            <div class="row end"><button class="btn primary" :disabled="busy">{{ busy ? '登录中…' : '登录' }}</button></div>
          </form>
        </template>
      </div>
    </section>
  </div>
</template>
