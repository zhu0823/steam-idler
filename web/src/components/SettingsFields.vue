<script setup>
// 挂卡参数表单字段，全局默认值和账号覆盖共用
import { FARMING_ORDERS } from '../api';

defineProps({ form: { type: Object, required: true } });
</script>

<template>
  <div class="form-grid">
    <div class="field">
      <label for="f-max">同时挂的游戏数上限</label>
      <div class="input-suffix"><input id="f-max" v-model.number="form.maxConcurrent" class="input num" type="number" min="1" max="32" required /><span>个</span></div>
      <span class="hint">1–32，Steam 最多允许同时 32 个；设置了挂卡状态文本时最多 31 个</span>
    </div>
    <div class="field">
      <label for="f-hours">单独挂的时长阈值</label>
      <div class="input-suffix"><input id="f-hours" v-model.number="form.hoursUntilDrops" class="input num" type="number" min="0" max="100" step="0.5" required /><span>小时</span></div>
      <span class="hint">未满阈值的游戏先同时挂；0 表示始终逐个挂</span>
    </div>
    <div class="field">
      <label for="f-interval">检查间隔</label>
      <div class="input-suffix"><input id="f-interval" v-model.number="form.checkIntervalMinutes" class="input num" type="number" min="5" max="1440" required /><span>分钟</span></div>
      <span class="hint">定时读取徽章页的间隔，最小 5 分钟</span>
    </div>
    <div class="field">
      <label for="f-persona">在线状态</label>
      <select id="f-persona" v-model="form.personaState" class="select">
        <option value="online">在线</option>
        <option value="invisible">隐身</option>
        <option value="offline">离线</option>
      </select>
      <span class="hint">挂卡时好友列表中显示的状态</span>
    </div>
    <div class="field">
      <label for="f-order">挂卡顺序</label>
      <select id="f-order" v-model="form.farmingOrder" class="select">
        <option v-for="[value, label] in FARMING_ORDERS" :key="value" :value="value">{{ label }}</option>
      </select>
      <span class="hint">决定同时挂时先挑哪些游戏、满阈值后先单独挂哪个；优先队列中的游戏总是最先</span>
    </div>
    <div class="field">
      <label for="f-machine">设备名称</label>
      <input id="f-machine" v-model="form.machineName" class="input mono" maxlength="64" required />
      <span class="hint">显示在 Steam 授权设备列表中，下次登录时生效</span>
    </div>
    <div class="field">
      <label for="f-farm-text">挂卡时的状态文本</label>
      <input id="f-farm-text" v-model="form.farmingStatusText" class="input" maxlength="64" placeholder="留空则不显示，例如：挂卡中 · {name}" />
      <span class="hint">好友看到的“正在游戏”，可用 {name} {appid} {count}；同时挂多个时取第一个游戏</span>
    </div>
    <div class="field">
      <label for="f-idle-text">卡片掉完后的状态文本</label>
      <input id="f-idle-text" v-model="form.idleStatusText" class="input" maxlength="64" placeholder="留空则不显示" />
      <span class="hint">没有可挂卡的游戏时显示，可与账号设置中“掉完后挂的游戏”同时使用</span>
    </div>
    <div class="setting-row full">
      <div>
        <div class="t">跳过退款期内的游戏</div>
        <div class="d">购买不满 14 天且游玩不足 2 小时的游戏不挂，避免失去退款资格；激活码、赠送的游戏不受影响</div>
      </div>
      <button type="button" class="switch" :class="{ on: form.skipRefundable }" role="switch" :aria-checked="form.skipRefundable" @click="form.skipRefundable = !form.skipRefundable"></button>
    </div>
    <div class="setting-row full">
      <div>
        <div class="t">跳过从未玩过的游戏</div>
        <div class="d">游玩时长为 0 的游戏不挂，等自己玩过之后再挂卡</div>
      </div>
      <button type="button" class="switch" :class="{ on: form.skipUnplayed }" role="switch" :aria-checked="form.skipUnplayed" @click="form.skipUnplayed = !form.skipUnplayed"></button>
    </div>
  </div>
</template>
