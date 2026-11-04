<script setup lang="ts">
import { useDemoI18n } from '../i18n';
import { computed, ref } from 'vue';
import WorkbenchIcon from './WorkbenchIcon.vue';
import type { WorkbenchFamilyId, WorkbenchFormat, WorkbenchFormatFamily } from './workbench';

const { t } = useDemoI18n();

const props = defineProps<{
  families: WorkbenchFormatFamily[];
  selectedFamily: WorkbenchFamilyId;
  activeExtension: string;
  sampleExtensions: ReadonlySet<string>;
}>();
const emit = defineEmits<{
  family: [id: WorkbenchFamilyId];
  sample: [extension: string];
}>();
const search = ref('');
const query = computed(() => search.value.trim().toLowerCase().replace(/^\./, ''));
const categories = computed(() => props.families
  .filter(family => query.value || family.id === props.selectedFamily)
  .flatMap(family => family.categories.map(category => ({
    ...category,
    key: `${family.id}:${category.id}`,
    formats: category.formats.filter(format => !query.value ||
      `${format.extension} ${format.label} ${category.label} ${family.label}`.toLowerCase().includes(query.value))
  })))
  .filter(category => category.formats.length));
const resultCount = computed(() => categories.value.reduce((count, category) => count + category.formats.length, 0));
const canPreview = (format: WorkbenchFormat) => (format.supported || format.sampleOnly) && props.sampleExtensions.has(format.extension);
function formatHint(format: WorkbenchFormat): string {
  if (format.sampleOnly) return t('转换后 SVG 展示示例；暂不支持直接上传原格式', 'Converted SVG sample; uploading the original format is not supported yet');
  if (!format.supported) return t('暂不支持预览', 'Preview is not supported yet');
  if (!props.sampleExtensions.has(format.extension)) return t('已支持，暂无示例；可导入文件预览', 'Supported, no sample yet; import a file to preview');
  if (['ai', 'eps', 'ps'].includes(format.extension)) return t('预览设计原文件并保留矢量缩放；部分字体功能受限', 'Preview original vector artwork; some font features are limited');
  if (['psd', 'psb'].includes(format.extension)) return t('预览 PSD/PSB 原文件中已保存的合成图（8 位 RGB / 灰度）', 'Preview the saved composite in PSD/PSB files (8-bit RGB / grayscale)');
  return props.sampleExtensions.has(format.extension) ? t(`预览 ${format.label} 示例`, `Preview ${format.label} sample`) : t('支持上传预览，暂无内置示例', 'Upload to preview; no built-in sample yet');
}
function chooseSample(extension: string): void {
  search.value = '';
  emit('sample', extension);
}
</script>

<template>
  <section class="wb-library" :aria-label="t('示例资料库', 'Sample library')">
    <div class="wb-library-heading">
      <div><p class="wb-eyebrow">EXPLORE FILES</p><h2>{{ t('示例资料库', 'Sample library') }}</h2></div>
      <span class="wb-library-count" :title="t('当前列出的格式数量', 'Number of listed formats')">{{ resultCount }}</span>
    </div>
    <p class="wb-library-description">{{ t('选一个格式，看看文件里的世界。', 'Choose a format and see what is inside.') }}</p>
    <div class="wb-search">
      <WorkbenchIcon name="search" />
      <input v-model="search" type="search" :aria-label="t('搜索文件格式', 'Search file formats')" :placeholder="t('搜索格式，如 PDF、3D…', 'Search formats, e.g. PDF, 3D…')" />
      <button v-if="search" type="button" :aria-label="t('清除格式搜索', 'Clear format search')" @click="search = ''"><WorkbenchIcon name="close" /></button>
    </div>
    <nav class="wb-tabs" :aria-label="t('格式分类', 'Format categories')">
      <button v-for="family in families" :key="family.id" type="button" class="wb-tab"
        :class="{ 'is-active': selectedFamily === family.id && !query }" :aria-pressed="selectedFamily === family.id && !query"
        @click="search = ''; emit('family', family.id)">{{ family.label }}</button>
    </nav>
    <div class="wb-format-list" :aria-label="t('格式列表', 'Format list')">
      <p v-if="query" class="wb-search-results" role="status">{{ t(`找到 ${resultCount} 种格式`, `${resultCount} format${resultCount === 1 ? '' : 's'} found`) }}</p>
      <div v-for="category in categories" :key="category.key" class="wb-format-category">
        <h3>{{ category.label }} <span>{{ category.formats.length.toString().padStart(2, '0') }}</span></h3>
        <div class="wb-subformats">
          <button v-for="format in category.formats" :key="`${format.family}:${format.extension}`" type="button"
            class="wb-subformat" :class="{ 'is-active': activeExtension === format.extension, 'is-sample-only': format.sampleOnly, 'is-no-sample': format.supported && !sampleExtensions.has(format.extension), 'is-unavailable': !format.supported && !format.sampleOnly }"
            :aria-pressed="activeExtension === format.extension" :disabled="!canPreview(format)" :title="formatHint(format)"
            @click="chooseSample(format.extension)">{{ format.label }}</button>
        </div>
      </div>
      <div v-if="!resultCount" class="wb-search-empty"><WorkbenchIcon name="search" /><strong>{{ t('没有找到这个格式', 'No matching formats') }}</strong><p>{{ t('试试扩展名，或换个关键词。', 'Try a file extension or another keyword.') }}</p><button type="button" @click="search = ''">{{ t('查看全部格式', 'View all formats') }}</button></div>
    </div>
    <p class="wb-format-hint"><span><i></i>{{ t('可打开示例', 'Samples') }}</span><span><i class="is-no-sample"></i>{{ t('已支持，暂无示例', 'Supported, no sample') }}</span><span><i class="is-muted"></i>{{ t('暂不支持', 'Unsupported') }}</span></p>
  </section>
</template>
