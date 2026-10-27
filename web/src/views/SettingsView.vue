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
  farmingOrder: 'hours',
  skipRefundable: true,
  skipUnplayed: false,
  farmingStatusText: '',
  idleStatusText: '',
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

// 通知：密钥字段不回传，留空表示保持原值，“清除”在保存时提交 null
const CHANNEL_TEXT = { telegram: 'Telegram', bark: 'Bark', webhook: 'Webhook' };
const EVENTS = [
  ['authFailed', '登录凭据失效'],
  ['finished', '卡片全部掉完'],
  ['drops', '每次掉卡'],
];
const notify = reactive({
  telegram: { enabled: false, botToken: '', botTokenSet: false, chatId: '' },
  bark: { enabled: false, url: '', urlSet: false },
  webhook: { enabled: false, url: '', urlSet: false },
  events: { authFailed: true, finished: true, drops: false },
});
const clearSecret = reactive({ telegram: false, bark: false, webhook: false });
const notifyMsg = ref('');
const notifyErr = ref('');
const notifyBusy = ref(false);

function applyNotify(config) {
  Object.assign(notify, config);
  Object.assign(clearSecret, { telegram: false, bark: false, webhook: false });
}

function secretPayload(channel, key) {
  if (clearSecret[channel]) return null;
  return notify[channel][key] || undefined;
}

async function saveNotify() {
  notifyMsg.value = '';
  notifyErr.value = '';
  notifyBusy.value = true;
  try {
    applyNotify(
      await api('PUT', '/api/notify', {
        telegram: { enabled: notify.telegram.enabled, botToken: secretPayload('telegram', 'botToken'), chatId: notify.telegram.chatId },
        bark: { enabled: notify.bark.enabled, url: secretPayload('bark', 'url') },
        webhook: { enabled: notify.webhook.enabled, url: secretPayload('webhook', 'url') },
        events: { ...notify.events },
      }),
    );
    notifyMsg.value = '通知设置已保存';
  } catch (err) {
    notifyErr.value = err.message;
  } finally {
    notifyBusy.value = false;
  }
}

// 先保存当前填写的内容，测试的就是将要生效的配置
async function testNotify() {
  await saveNotify();
  if (notifyErr.value) return;
  notifyMsg.value = '';
  notifyBusy.value = true;
  try {
    const results = await api('POST', '/api/notify/test');
    const failed = results.filter((r) => !r.ok);
    if (failed.length) notifyErr.value = failed.map((r) => `${CHANNEL_TEXT[r.channel]}：${r.error}`).join('；');
    const ok = results.filter((r) => r.ok).map((r) => CHANNEL_TEXT[r.channel]);
    if (ok.length) notifyMsg.value = `已发送到 ${ok.join('、')}，请到对应应用查看`;
  } catch (err) {
    notifyErr.value = err.message;
  } finally {
    notifyBusy.value = false;
  }
}

onMounted(async () => {
  try {
    Object.assign(form, await api('GET', '/api/config'));
  } catch (err) {
    error.value = err.message;
  }
  try {
    applyNotify(await api('GET', '/api/notify'));
  } catch (err) {
    notifyErr.value = err.message;
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

  <form class="card card-pad stack" @submit.prevent="saveNotify">
    <div class="card-title">通知 <small>挂卡出现需要处理的情况时推送到手机</small></div>

    <div class="field">
      <label>推送哪些事件</label>
      <div class="checks">
        <label v-for="[key, label] in EVENTS" :key="key"><input v-model="notify.events[key]" type="checkbox" class="skip-toggle" />{{ label }}</label>
      </div>
    </div>

    <div class="channel">
      <div class="setting-row">
        <div>
          <div class="t">Telegram</div>
          <div class="d">通过 @BotFather 创建机器人，先给机器人发一条消息，再填写自己的 Chat ID</div>
        </div>
        <button type="button" class="switch" :class="{ on: notify.telegram.enabled }" role="switch" :aria-checked="notify.telegram.enabled" @click="notify.telegram.enabled = !notify.telegram.enabled"></button>
      </div>
      <div v-if="notify.telegram.enabled || notify.telegram.botTokenSet" class="form-grid">
        <div class="field">
          <label for="n-tg-token">Bot Token</label>
          <input
            id="n-tg-token"
            v-model="notify.telegram.botToken"
            class="input mono"
            type="password"
            autocomplete="off"
            :placeholder="clearSecret.telegram ? '保存后清除' : notify.telegram.botTokenSet ? '已设置，留空则不修改' : '123456:ABC-DEF…'"
          />
          <button v-if="notify.telegram.botTokenSet && !clearSecret.telegram" type="button" class="btn ghost sm" style="align-self: flex-start" @click="clearSecret.telegram = true">清除已保存的 Token</button>
        </div>
        <div class="field">
          <label for="n-tg-chat">Chat ID</label>
          <input id="n-tg-chat" v-model="notify.telegram.chatId" class="input mono" placeholder="例如：123456789" />
        </div>
      </div>
    </div>

    <div v-for="channel in ['bark', 'webhook']" :key="channel" class="channel">
      <div class="setting-row">
        <div>
          <div class="t">{{ CHANNEL_TEXT[channel] }}</div>
          <div class="d">
            {{ channel === 'bark' ? 'iOS 推送，填写 Bark App 中带设备 Key 的地址，例如 https://api.day.app/你的Key' : '以 JSON 格式 POST 到该地址，包含 event、title、text、account、time 字段' }}
          </div>
        </div>
        <button type="button" class="switch" :class="{ on: notify[channel].enabled }" role="switch" :aria-checked="notify[channel].enabled" @click="notify[channel].enabled = !notify[channel].enabled"></button>
      </div>
      <div v-if="notify[channel].enabled || notify[channel].urlSet" class="field">
        <label :for="`n-${channel}`">推送地址</label>
        <input
          :id="`n-${channel}`"
          v-model="notify[channel].url"
          class="input mono"
          type="password"
          autocomplete="off"
          :placeholder="clearSecret[channel] ? '保存后清除' : notify[channel].urlSet ? '已设置，留空则不修改' : 'https://…'"
        />
        <button v-if="notify[channel].urlSet && !clearSecret[channel]" type="button" class="btn ghost sm" style="align-self: flex-start" @click="clearSecret[channel] = true">清除已保存的地址</button>
      </div>
    </div>

    <p v-if="notifyErr" class="callout err"><Icon name="alert" />{{ notifyErr }}</p>
    <p v-if="notifyMsg" class="callout ok">{{ notifyMsg }}</p>
    <div class="row end">
      <button type="button" class="btn" :disabled="notifyBusy" @click="testNotify"><Icon name="bell" />发送测试通知</button>
      <button class="btn primary" :disabled="notifyBusy">{{ notifyBusy ? '处理中…' : '保存通知设置' }}</button>
    </div>
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
