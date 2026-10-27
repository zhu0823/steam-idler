<script setup>
// 挂卡参数表单字段，全局默认值和账号覆盖共用
defineProps({ form: { type: Object, required: true } });
</script>

<template>
  <div class="form-grid">
    <div class="field">
      <label for="f-max">同时挂的游戏数上限</label>
      <div class="input-suffix"><input id="f-max" v-model.number="form.maxConcurrent" class="input num" type="number" min="1" max="32" required /><span>个</span></div>
      <span class="hint">1–32，Steam 最多允许同时 32 个</span>
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
    <div class="field full">
      <label for="f-machine">设备名称</label>
      <input id="f-machine" v-model="form.machineName" class="input mono" maxlength="64" required />
      <span class="hint">显示在 Steam 授权设备列表中，下次登录时生效</span>
    </div>
  </div>
</template>
