<script setup>
// 剩余可掉张数（Steam 不提供整套卡片总数），超过 8 张时截断显示
defineProps({ count: { type: Number, required: true } });
</script>

<template>
  <span class="pips" :title="`还能掉 ${count} 张`"><i v-for="n in Math.min(count, 8)" :key="n"></i></span>
</template>
