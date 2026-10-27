<script setup>
import { computed } from 'vue';
import { accountName, avatarColor } from '../api';

const props = defineProps({
  account: { type: Object, required: true },
  large: { type: Boolean, default: false },
});

const name = computed(() => accountName(props.account));
</script>

<template>
  <span class="avatar" :class="{ lg: large }" :style="{ background: avatarColor(account.id) }">{{ name.slice(0, 2).toUpperCase() }}</span>
</template>
