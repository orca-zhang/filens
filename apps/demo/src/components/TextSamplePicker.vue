<script setup lang="ts">
import { textSamples, type TextSampleGroup } from '../text-samples';
import { useDemoI18n } from '../i18n';

defineProps<{ activeName: string }>();
const emit = defineEmits<{ select: [name: string] }>();
const { t } = useDemoI18n();
const groups: TextSampleGroup[] = ['documents', 'code', 'configuration', 'logs'];
const groupLabel = (group: TextSampleGroup) => ({
  documents: t('文档与笔记', 'Documents and notes'),
  code: t('代码', 'Source code'),
  configuration: t('配置', 'Configuration'),
  logs: t('日志', 'Logs')
})[group];
const formatCount = new Set(textSamples.map(sample => sample.format)).size;

function selectSample(event: Event): void {
  emit('select', (event.target as HTMLSelectElement).value);
}
</script>

<template>
  <nav class="text-samples" :aria-label="t('文本样例', 'Text samples')">
    <label>
      <span>{{ t('换一份文本', 'Explore the texts') }}</span>
      <select :value="activeName" :aria-label="t('选择文本样例', 'Choose a text sample')" @change="selectSample">
        <optgroup v-for="group in groups" :key="group" :label="groupLabel(group)">
          <option v-for="sample in textSamples.filter(item => item.group === group)" :key="sample.name" :value="sample.name">
            {{ t(sample.titleZh, sample.titleEn) }} · {{ sample.format.toUpperCase() }}
          </option>
        </optgroup>
      </select>
    </label>
    <small>{{ t(`${textSamples.length} 份样例 · ${formatCount} 种格式`, `${textSamples.length} samples · ${formatCount} formats`) }}</small>
  </nav>
</template>

<style scoped>
.text-samples { display: flex; flex-shrink: 0; align-items: center; gap: 16px; min-width: 0; margin: -5px 0 15px; }
.text-samples label { display: flex; flex: 1; align-items: center; gap: 16px; min-width: 0; }
.text-samples label > span { flex-shrink: 0; color: #828992; font-size: 10px; }
.text-samples select { width: 100%; max-width: 420px; min-width: 0; padding: 10px 32px 10px 12px; border: 1px solid #dfe3e8; border-radius: 7px; background: #fff; color: #48515c; font: inherit; font-size: 12px; }
.text-samples select:hover { border-color: #bd8a69; }
.text-samples select:focus-visible { outline: 2px solid #bd8a69; outline-offset: 2px; }
.text-samples small { flex-shrink: 0; color: #828992; font-size: 10px; }
@media (max-width: 650px) {
  .text-samples { flex-wrap: wrap; gap: 7px; }
  .text-samples label { flex-basis: 100%; gap: 10px; }
  .text-samples small { margin-left: auto; }
}
</style>
