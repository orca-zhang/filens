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
  import: [extension: string];
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
function formatHint(format: WorkbenchFormat): string {
  if (!props.sampleExtensions.has(format.extension)) return t('已支持，点击导入文件预览；暂无内置示例', 'Supported; click to import a file. No built-in sample yet');
  if (['tif', 'tiff'].includes(format.extension)) return t('本地预览 TIFF 首页，支持常见压缩及 16 位图像；多页和色彩配置不保留', 'Preview the first TIFF image locally, including common compression and 16-bit images; additional pages and color profiles are not preserved');
  if (format.extension === 'dwg') return t('本地转为 DXF 后提供二维预览；复杂实体、外部参照及 SHX 字体可能简化或省略', 'Convert locally to DXF for 2D preview; complex entities, external references and SHX fonts may be simplified or omitted');
  if (format.extension === 'dds') return t('预览 DDS 首个纹理表面；不展示 mipmap、数组层和其他立方体面', 'Preview the first DDS texture surface; mipmaps, array layers and other cube faces are omitted');
  if (format.extension === 'hdr') return t('将 Radiance HDR 转为 8 位图片预览；不保留完整动态范围', 'Preview Radiance HDR as an 8-bit image; full dynamic range is not preserved');
  if (format.extension === 'exr') return t('预览 OpenEXR 默认图像和颜色通道，转换为 8 位图片；不保留其他分层和完整动态范围', 'Preview the default OpenEXR image and color channels as an 8-bit image; other layers and full dynamic range are omitted');
  if (format.extension === 'jxl') return t('预览 JPEG XL 首帧，转换为 8 位图片；不保留动画、HDR 和印刷色彩配置', 'Preview the first JPEG XL frame as an 8-bit image; animation, HDR and print profiles are omitted');
  if (['cbr', 'cb7', 'cbt'].includes(format.extension)) return t('浏览漫画归档并打开图片；暂不提供连续翻页阅读', 'Browse the comic archive and open image pages; sequential book reading is not available');
  if (format.extension === 'zipx') return t('支持 Deflate、Deflate64、BZip2、LZMA 等压缩方式；部分 WinZip 专有压缩方法可能无法读取', 'Supports Deflate, Deflate64, BZip2 and LZMA; some proprietary WinZip compression methods may be unreadable');
  if (['xpi', 'crx'].includes(format.extension)) return t('浏览扩展包内的文件并预览内容', 'Browse files and preview content inside the extension package');
  if (['bz2', 'bzip2', 'xz', 'lzma', 'lzma86', 'zst', 'zstd', 'tbz', 'tbz2', 'txz', 'tlz', 'tzst', 'z', 'taz'].includes(format.extension)) return t('本地解压并预览文件；压缩的 TAR 包会直接展开目录', 'Decompress locally and preview the file; compressed TAR archives open as directories');
  if (format.extension === 'deb') return t('浏览 Debian 包及内嵌的 control/data 压缩包，预览包内文件', 'Browse the Debian package, nested control/data archives and their files');
  if (format.extension === 'rpm') return t('浏览 RPM 包的压缩 CPIO 内容并预览文件', 'Browse the compressed CPIO payload and preview files inside the RPM package');
  if (['iso', 'udf'].includes(format.extension)) return t('浏览 ISO 9660、Joliet 或 UDF 光盘镜像中的文件', 'Browse files in ISO 9660, Joliet or UDF optical-disc images');
  if (['wim', 'esd'].includes(format.extension)) return t('浏览 Windows 镜像内的文件，支持 LZX、XPRESS 和 LZMS；暂不支持分卷 SWM', 'Browse files inside Windows images with LZX, XPRESS and LZMS; split SWM images are unsupported');
  if (['ar', 'cpio', 'cab', 'lha', 'lzh', 'xar'].includes(format.extension)) return t('浏览归档目录并预览包内文件', 'Browse the archive and preview its files');
  if (['heic', 'heif'].includes(format.extension)) return t('已支持 HEIC/HEIF 主图预览；浏览器无法解码时使用本地解码器', 'HEIC/HEIF primary still images are supported, with a local decoder when browser decoding is unavailable');
  if (['ai', 'eps', 'ps'].includes(format.extension)) return t('预览设计原文件并保留矢量缩放；部分字体功能受限', 'Preview original vector artwork; some font features are limited');
  if (['psd', 'psb'].includes(format.extension)) return t('预览 PSD/PSB 原文件中已保存的合成图（8 位 RGB / 灰度）', 'Preview the saved composite in PSD/PSB files (8-bit RGB / grayscale)');
  return t(`预览 ${format.label} 示例`, `Preview ${format.label} sample`);
}
function previewDetail(extension: string): string {
  if (['tif', 'tiff'].includes(extension)) return t('首页预览', 'First image');
  if (extension === 'dwg') return t('二维预览', '2D preview');
  if (extension === 'dds') return t('首个表面', 'First surface');
  if (extension === 'hdr') return t('8 位预览', '8-bit preview');
  if (extension === 'exr') return t('8 位预览', '8-bit preview');
  if (extension === 'jxl') return t('首帧预览', 'First frame');
  if (['cbr', 'cb7', 'cbt'].includes(extension)) return t('浏览内容', 'Browse files');
  return '';
}
function chooseFormat(format: WorkbenchFormat): void {
  if (!props.sampleExtensions.has(format.extension)) {
    emit('import', format.extension);
    return;
  }
  search.value = '';
  emit('sample', format.extension);
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
    <p class="wb-support-summary" role="status">{{ t(`已支持 ${resultCount} 种格式`, `${resultCount} supported formats`) }}</p>
    <div class="wb-format-list" :aria-label="t('格式列表', 'Format list')">
      <p v-if="query" class="wb-search-results" role="status">{{ t(`找到 ${resultCount} 种格式`, `${resultCount} format${resultCount === 1 ? '' : 's'} found`) }}</p>
      <div v-for="category in categories" :key="category.key" class="wb-format-category">
        <h3>{{ category.label }} <span>{{ category.formats.length.toString().padStart(2, '0') }}</span></h3>
        <div class="wb-subformats">
          <button v-for="format in category.formats" :key="`${format.family}:${format.extension}`" type="button"
            class="wb-subformat" :class="{ 'is-active': activeExtension === format.extension, 'is-no-sample': !sampleExtensions.has(format.extension) }"
            :data-support="sampleExtensions.has(format.extension) ? 'sample' : 'supported'"
            :aria-label="format.label" :aria-description="formatHint(format)" :aria-pressed="activeExtension === format.extension" :title="formatHint(format)"
            @click="chooseFormat(format)"><span>{{ format.label }}</span><small v-if="!sampleExtensions.has(format.extension)" class="wb-format-detail">{{ t('导入预览', 'Import file') }}</small><small v-else-if="previewDetail(format.extension)" class="wb-format-detail">{{ previewDetail(format.extension) }}</small></button>
        </div>
      </div>
      <div v-if="!resultCount" class="wb-search-empty"><WorkbenchIcon name="search" /><strong>{{ t('没有找到这个格式', 'No matching formats') }}</strong><p>{{ t('试试扩展名，或换个关键词。', 'Try a file extension or another keyword.') }}</p><button type="button" @click="search = ''">{{ t('查看全部格式', 'View all formats') }}</button></div>
    </div>
    <p class="wb-format-hint"><span><i></i>{{ t('可预览示例', 'Samples') }}</span><span><i class="is-no-sample"></i>{{ t('已支持，需导入', 'Import to preview') }}</span></p>
  </section>
</template>
