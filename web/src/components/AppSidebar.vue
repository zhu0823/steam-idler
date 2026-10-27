<script setup>
import { computed } from 'vue';
import { STATE_TEXT, accountName, live } from '../api';
import { openAccount, openAdd, openPage, ui } from '../ui';
import Icon from './Icon.vue';
import AccountAvatar from './AccountAvatar.vue';

defineProps({ theme: { type: String, required: true } });
const emit = defineEmits(['logout', 'toggle-theme']);

const accounts = computed(() => live.status?.accounts || []);

function subText(a) {
  if (a.state === 'auth_failed') return '需要重新登录';
  if (!a.lastCheckAt) return STATE_TEXT[a.state]?.[0] || '';
  return `剩 ${a.totalDrops} 张 · ${a.playing.length} 个游戏`;
}
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <span class="brand-mark"><Icon name="logo" /></span>
      <div>
        <div class="brand-name">Steam Idler</div>
        <div class="brand-sub">自托管挂卡</div>
      </div>
    </div>

    <nav class="nav">
      <button class="nav-item" :class="{ active: ui.page === 'overview' }" @click="openPage('overview')"><Icon name="home" />概览</button>
      <button class="nav-item" :class="{ active: ui.page === 'settings' }" @click="openPage('settings')"><Icon name="gear" />全局设置</button>
    </nav>

    <div>
      <div class="side-label"><span>账号</span><span>{{ accounts.length }}</span></div>
      <div class="acct-list">
        <button
          v-for="a in accounts"
          :key="a.id"
          class="acct-item"
          :class="{ active: ui.page === 'account' && ui.accountId === a.id }"
          @click="openAccount(a.id)"
        >
          <AccountAvatar :account="a" />
          <span class="meta">
            <div class="name">{{ accountName(a) }}</div>
            <div class="sub">{{ subText(a) }}</div>
          </span>
          <span class="dot" :class="STATE_TEXT[a.state]?.[1]"></span>
        </button>
      </div>
      <button class="side-add" @click="openAdd()"><Icon name="plus" />添加账号</button>
    </div>

    <div class="side-foot">
      <span class="live" :class="{ off: !live.connected }">{{ live.connected ? '实时连接' : '正在重连' }}</span>
      <div class="row">
        <button class="btn sm icon-only" :title="theme === 'dark' ? '切换到浅色' : '切换到深色'" @click="emit('toggle-theme')">
          <Icon :name="theme === 'dark' ? 'sun' : 'moon'" />
        </button>
        <button class="btn sm" @click="emit('logout')">退出面板</button>
      </div>
    </div>
  </aside>
</template>
