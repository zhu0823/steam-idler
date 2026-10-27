<script setup>
import { ICONS } from '../icons';

defineProps({ name: { type: String, required: true } });
</script>

<template>
  <!-- 图标为内置常量，非用户输入 -->
  <span class="icon" aria-hidden="true" v-html="ICONS[name]"></span>
</template>
