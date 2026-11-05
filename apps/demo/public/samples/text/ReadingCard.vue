<script setup lang="ts">
import { computed, ref } from 'vue';

const props = defineProps<{ title: string; author: string; minutes: number }>();
const saved = ref(false);
const readingTime = computed(() => Math.max(1, Math.round(props.minutes)));
</script>

<template>
  <article class="reading-card">
    <p class="eyebrow">岸线阅读室 / WEEKEND READING</p>
    <h2>{{ title }}</h2>
    <p>{{ author }} · 约 {{ readingTime }} 分钟</p>
    <slot />
    <button type="button" :aria-pressed="saved" @click="saved = !saved">
      {{ saved ? '已加入书签' : '留到周末读' }}
    </button>
  </article>
</template>

<style scoped>
.reading-card { padding: 2rem; background: #f6f2e9; color: #24352e; }
.eyebrow { font-size: 0.75rem; letter-spacing: 0.12em; }
button { padding: 0.6rem 1rem; border: 1px solid currentColor; background: none; }
</style>
