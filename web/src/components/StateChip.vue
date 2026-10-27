<script setup>
import { computed } from 'vue';
import { STATE_TEXT } from '../api';

const props = defineProps({ state: { type: String, required: true } });
const info = computed(() => STATE_TEXT[props.state] || ['—', '']);
</script>

<template>
  <span class="chip" :class="info[1]">{{ info[0] }}</span>
</template>
