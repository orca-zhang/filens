<script setup lang="ts">
import { modelSamples } from '../model-samples';
import { useDemoI18n } from '../i18n';

defineProps<{ activeName: string }>();
const emit = defineEmits<{ select: [name: string] }>();
const { t } = useDemoI18n();
const thumbnail = (id: string) => `${import.meta.env.BASE_URL}samples/models/${id}.webp`;
</script>

<template>
  <nav class="model-samples" :aria-label="t('3D 模型样例', '3D model samples')">
    <span class="model-samples-label">{{ t('换一个模型', 'Explore the models') }}</span>
    <div class="model-samples-list">
      <button v-for="sample in modelSamples" :key="sample.id" type="button"
        :aria-pressed="activeName === sample.name" @click="emit('select', sample.name)">
        <img :src="thumbnail(sample.id)" alt="" width="64" height="52" />
        <span>{{ t(sample.titleZh, sample.titleEn) }}<small>{{ sample.format.toUpperCase() }}</small></span>
      </button>
    </div>
  </nav>
</template>

<style scoped>
.model-samples { display: flex; flex-shrink: 0; align-items: center; gap: 16px; min-width: 0; margin: -5px 0 15px; }
.model-samples-label { flex-shrink: 0; color: #828992; font-size: 10px; }
.model-samples-list { display: flex; gap: 8px; min-width: 0; padding: 4px; overflow-x: auto; scrollbar-width: thin; }
.model-samples button { display: flex; flex-shrink: 0; align-items: center; gap: 9px; padding: 5px 12px 5px 5px; border: 1px solid #dfe3e8; border-radius: 7px; background: #fff; color: #727b86; font-size: 11px; white-space: nowrap; }
.model-samples button:hover { border-color: #c69c80; color: #76513b; }
.model-samples button[aria-pressed="true"] { border-color: #bd8a69; background: #fcf5ef; color: #795036; box-shadow: 0 0 0 1px #bd8a6920; }
.model-samples img { width: 64px; height: 52px; border-radius: 3px; object-fit: cover; background: #111827; }
.model-samples small { display: block; margin-top: 3px; color: #828992; font-size: 9px; text-align: left; }
@media (max-width: 1100px) {
  .model-samples { display: block; margin-bottom: 10px; }
  .model-samples-label { display: block; margin: 0 4px 4px; }
  .model-samples-list { padding-block: 4px 7px; }
}
</style>
