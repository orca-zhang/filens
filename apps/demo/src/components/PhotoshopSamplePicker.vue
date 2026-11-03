<script setup lang="ts">
import { photoshopSamples } from '../photoshop-samples';
import { useDemoI18n } from '../i18n';

defineProps<{ activeName: string }>();
const emit = defineEmits<{ select: [name: string] }>();
const { t } = useDemoI18n();
const thumbnail = (id: string) => `${import.meta.env.BASE_URL}samples/design/${id}.webp`;
</script>

<template>
  <nav class="photoshop-samples" :aria-label="t('Photoshop 设计稿样例', 'Photoshop design samples')">
    <span class="photoshop-samples-label">{{ t('换一份设计稿', 'Explore the designs') }}</span>
    <div class="photoshop-samples-list">
      <button v-for="sample in photoshopSamples" :key="sample.id" type="button"
        :aria-pressed="activeName === sample.name" @click="emit('select', sample.name)">
        <img :src="thumbnail(sample.id)" alt="" width="64" height="44" />
        <span>{{ t(sample.titleZh, sample.titleEn) }}</span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.photoshop-samples { display: flex; flex-shrink: 0; align-items: center; gap: 16px; min-width: 0; margin: -5px 0 15px; }
.photoshop-samples-label { flex-shrink: 0; color: #828992; font-size: 10px; }
.photoshop-samples-list { display: flex; gap: 8px; min-width: 0; padding: 4px; overflow-x: auto; scrollbar-width: thin; }
.photoshop-samples button { display: flex; flex-shrink: 0; align-items: center; gap: 9px; padding: 5px 12px 5px 5px; border: 1px solid #dfe3e8; border-radius: 7px; background: #fff; color: #727b86; font-size: 11px; white-space: nowrap; }
.photoshop-samples button:hover { border-color: #c69c80; color: #76513b; }
.photoshop-samples button[aria-pressed="true"] { border-color: #bd8a69; background: #fcf5ef; color: #795036; box-shadow: 0 0 0 1px #bd8a6920; }
.photoshop-samples img { width: 64px; height: 44px; border-radius: 3px; object-fit: cover; }
@media (max-width: 1100px) {
  .photoshop-samples { display: block; margin-bottom: 10px; }
  .photoshop-samples-label { display: block; margin: 0 4px 4px; }
  .photoshop-samples-list { padding-block: 4px 7px; }
}
</style>
