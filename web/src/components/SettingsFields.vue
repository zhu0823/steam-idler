<script setup>
// 挂卡参数表单字段，全局默认值和账号覆盖共用
defineProps({ form: { type: Object, required: true } });
</script>

<template>
  <div class="grid">
    <label>
      同时挂的游戏数上限
      <input v-model.number="form.maxConcurrent" type="number" min="1" max="32" required />
      <span class="muted small">1–32，Steam 最多允许 32 个</span>
    </label>
    <label>
      单独挂的时长阈值（小时）
      <input v-model.number="form.hoursUntilDrops" type="number" min="0" max="100" step="0.5" required />
      <span class="muted small">未达到阈值的游戏同时挂；0 表示始终逐个挂</span>
    </label>
    <label>
      检查间隔（分钟）
      <input v-model.number="form.checkIntervalMinutes" type="number" min="5" max="1440" required />
      <span class="muted small">定时读取徽章页的间隔，最小 5 分钟</span>
    </label>
    <label>
      在线状态
      <select v-model="form.personaState">
        <option value="online">在线</option>
        <option value="invisible">隐身</option>
        <option value="offline">离线</option>
      </select>
    </label>
    <label>
      设备名称
      <input v-model="form.machineName" maxlength="64" required />
      <span class="muted small">显示在 Steam 授权设备列表中，下次登录 Steam 时生效</span>
    </label>
  </div>
</template>
