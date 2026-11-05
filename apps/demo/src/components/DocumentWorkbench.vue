<script setup lang="ts">
import { useDemoI18n } from '../i18n';
import { computed, defineAsyncComponent, ref, useId, watch } from 'vue';
import FileFormatIcon from './FileFormatIcon.vue';
import FormatBrowser from './FormatBrowser.vue';
import WorkbenchIcon from './WorkbenchIcon.vue';
import type { WorkbenchFamilyId, WorkbenchFormatFamily } from './workbench';

const { t, toggleLocale } = useDemoI18n();

const props = defineProps<{
  section: 'preview' | 'agent';
  brandIcon: string;
  name: string;
  label: string;
  extension: string;
  family: string;
  source: string;
  thirdPartySource: { url: string; origin: string } | null;
  uploadAccept: string;
  families: WorkbenchFormatFamily[];
  selectedFamily: WorkbenchFamilyId;
  sampleExtensions: ReadonlySet<string>;
  timings: Array<{ label: string; value: string }>;
  modelSummary: Array<{ label: string; value: string }>;
  ready: boolean;
  error: string | null;
  warningCount: number;
  hasToolbar: boolean;
}>();
const remoteUrl = defineModel<string>('remoteUrl', { required: true });
const toolbar = defineModel<boolean>('toolbar', { required: true });
const emit = defineEmits<{
  section: [section: 'preview' | 'agent'];
  home: [];
  upload: [files: File[]];
  remote: [];
  family: [id: WorkbenchFamilyId];
  sample: [extension: string];
}>();
const AgentWorkbench = defineAsyncComponent(() => import('./AgentWorkbench.vue'));
const previewOpened = ref(props.section === 'preview');
const agentOpened = ref(props.section === 'agent');
const libraryOpen = ref(!window.matchMedia('(max-width: 760px)').matches);
const detailsOpen = ref(false);
const linkDialog = ref<HTMLDialogElement>();
const linkButton = ref<HTMLButtonElement>();
const linkInput = ref<HTMLInputElement>();
const formatInput = ref<HTMLInputElement>();
const dragDepth = ref(0);
const panelId = useId();
const detailId = useId();
watch(() => props.section, section => {
  if (section === 'preview') previewOpened.value = true;
  else agentOpened.value = true;
  detailsOpen.value = false;
});
const sourceLabel = computed(() => ({ upload: t('本地文件', 'Local file'), url: t('远程文件', 'Remote file'), generated: t('生成示例', 'Generated sample'), sample: t('内置示例', 'Built-in sample') })[props.source] ?? props.source);
const extensionLabel = computed(() => props.extension.toUpperCase() || 'FILE');
const fileColor = computed(() => {
  if (['model3d', 'cad', 'diagram', 'mindmap'].includes(props.family)) return '#8570b3';
  if (['image', 'panorama', 'panorama-video', 'audio', 'video'].includes(props.family)) return '#438575';
  if (props.family === 'archive') return '#ab8546';
  if (['text', 'code', 'html', 'ebook'].includes(props.family)) return '#5b7ea7';
  return '#b96949';
});
const status = computed(() => props.error ? t('预览失败', 'Preview failed') : props.ready ? t('预览就绪', 'Preview ready') : t('正在打开文件…', 'Opening file…'));
function upload(event: Event): void {
  const input = event.target as HTMLInputElement;
  emit('upload', Array.from(input.files ?? []));
  input.value = '';
}
function isFileDrag(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files');
}
function dragEnter(event: DragEvent): void {
  if (isFileDrag(event)) { event.preventDefault(); dragDepth.value++; }
}
function dragOver(event: DragEvent): void {
  if (isFileDrag(event)) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  }
}
function drop(event: DragEvent): void {
  dragDepth.value = 0;
  if (!isFileDrag(event)) return;
  event.preventDefault();
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (files.length) emit('upload', files);
}
function selectSample(extension: string): void {
  emit('section', 'preview');
  emit('sample', extension);
  if (window.matchMedia('(max-width: 760px)').matches) libraryOpen.value = false;
}
function importSupportedFormat(extension: string): void {
  // The file picker still permits companion resources; the chosen format is a hint.
  if (formatInput.value) {
    formatInput.value.accept = `.${extension}`;
    formatInput.value.click();
  }
}
function selectSection(section: 'preview' | 'agent'): void {
  emit('section', section);
  if (window.matchMedia('(max-width: 760px)').matches) libraryOpen.value = false;
}
function openLink(): void {
  linkDialog.value?.showModal();
  linkInput.value?.focus();
  linkInput.value?.select();
}
function closeLink(): void {
  linkDialog.value?.close();
  linkButton.value?.focus();
}
function openRemote(): void {
  if (!remoteUrl.value.trim()) return;
  remoteUrl.value = remoteUrl.value.trim();
  emit('remote');
  closeLink();
}
</script>

<template>
  <main class="workbench" :class="{ 'is-library-closed': !libraryOpen }" @dragenter="dragEnter" @dragover="dragOver" @dragleave="dragDepth = Math.max(0, dragDepth - 1)" @drop="drop" @keydown.esc="detailsOpen = false">
    <aside v-show="libraryOpen" :id="panelId" class="wb-sidebar" :aria-label="section === 'agent' ? t('Agent 工具与信息', 'Agent tools and information') : t('格式与预览信息', 'Formats and preview information')">
      <button class="wb-brand wb-home-link" type="button" :aria-label="t('← 探微首页', '← filens home')" @click="emit('home')">
        <img :src="brandIcon" alt="" width="34" height="34" />
        <span>{{ t('探微', 'filens') }}<span class="wb-brand-caption">{{ t('文件里的世界', 'The world inside files') }}</span></span>
        <WorkbenchIcon name="arrow" />
      </button>
      <FormatBrowser v-show="section === 'preview'" :families="families" :selected-family="selectedFamily" :active-extension="extension" :sample-extensions="sampleExtensions" @family="emit('family', $event)" @sample="selectSample" @import="importSupportedFormat" />
      <input ref="formatInput" type="file" multiple hidden :aria-label="t('导入所选格式文件', 'Import selected format')" @change="upload" />
      <section v-if="section === 'agent'" class="wb-agent-sidebar" :aria-label="t('Agent 工具箱', 'Agent toolbox')">
        <p class="wb-eyebrow">LOCAL FILE TOOLS</p><h2>{{ t('Agent 工具箱', 'Agent toolbox') }}</h2><p>{{ t('给 Agent 一双看见文件的眼睛。', 'Give your Agent a way to see inside files.') }}</p>
        <div><WorkbenchIcon name="file" /><span>{{ t('文档读取与证据', 'Document reading and evidence') }}</span></div><div><WorkbenchIcon name="search" /><span>{{ t('跨格式目录搜索', 'Search across file formats') }}</span></div><div><WorkbenchIcon name="scan" /><span>{{ t('本地 OCR 与布局', 'Local OCR and layout') }}</span></div><div><WorkbenchIcon name="sliders" /><span>{{ t('关键原文提取', 'Extract key passages') }}</span></div><div><WorkbenchIcon name="copy" /><span>{{ t('重复文件与相似图片', 'Duplicates and similar images') }}</span></div><div><WorkbenchIcon name="arrow" /><span>{{ t('多格式文件转换', 'Convert file formats') }}</span></div>
        <p class="wb-agent-sidebar-note">{{ t('通过 CLI 在本机运行，使用 Skill 接入你的 Agent。', 'Run locally with the CLI and connect your Agent using the skill.') }}</p>
      </section>
      <div class="wb-privacy"><WorkbenchIcon name="lock" /><div><strong>{{ t('本地文件，无需上传', 'Local files stay on your device') }}</strong><p>{{ section === 'agent' ? t('在你的设备上，安心处理。', 'Process files on your own device.') : t('在你的浏览器里，安心打开。', 'Open files in your browser.') }}</p></div></div>
    </aside>
    <button v-if="libraryOpen" class="wb-sidebar-scrim" type="button" :aria-label="t('关闭格式面板', 'Close format panel')" @click="libraryOpen = false"></button>

    <div class="wb-main">
      <header class="wb-header">
        <button class="wb-icon-button wb-library-toggle" type="button" :aria-label="libraryOpen ? t('收起格式面板', 'Collapse format panel') : t('展开格式面板', 'Expand format panel')" :aria-expanded="libraryOpen" :aria-controls="panelId" @click="libraryOpen = !libraryOpen"><WorkbenchIcon name="panel" /></button>
        <div class="wb-heading"><p class="wb-eyebrow">WORKSPACE <span>/</span> {{ section.toUpperCase() }}</p><h1 class="visually-hidden">{{ section === 'agent' ? t('Agent 控制台', 'Agent console') : t('文件预览台', 'File preview') }}</h1><nav class="wb-workspace-nav" :aria-label="t('控制台功能', 'Console navigation')"><button type="button" :aria-pressed="section === 'preview'" @click="selectSection('preview')">{{ t('文件预览', 'Preview') }}</button><button type="button" :aria-pressed="section === 'agent'" @click="selectSection('agent')">Agent</button></nav></div>
        <div class="wb-header-tools">
          <div v-show="section === 'preview'" class="wb-header-actions">
            <button ref="linkButton" class="wb-button wb-link-button" type="button" :aria-label="t('通过链接打开', 'Open from link')" @click="openLink"><WorkbenchIcon name="link" /><span>{{ t('通过链接打开', 'Open from link') }}</span></button>
            <label class="wb-button wb-upload" :title="t('导入文件', 'Import files')"><WorkbenchIcon name="upload" /><span>{{ t('导入文件', 'Import files') }}</span><input class="visually-hidden" type="file" :aria-label="t('导入文件', 'Import files')" :accept="uploadAccept" multiple @change="upload" /></label>
          </div>
          <button class="wb-button wb-language-toggle" type="button" :aria-label="t('Switch to English', '切换到中文')" @click="toggleLocale"><span aria-hidden="true">◎</span>{{ t('EN', '中文') }}</button>
        </div>
      </header>

      <div v-if="previewOpened" v-show="section === 'preview'" class="wb-body">
        <div class="wb-workspace-label"><span><i></i> {{ sourceLabel }}</span><span class="wb-workspace-hint">{{ t('让内容，成为主角。', 'Let the content take center stage.') }}</span></div>
        <slot name="samples" />
        <section class="wb-preview" :aria-label="t(`${name} 预览`, `${name} preview`)">
          <header class="wb-preview-head">
            <FileFormatIcon :label="extensionLabel.slice(0, 5)" :color="fileColor" small />
            <div class="wb-preview-title"><strong :title="name">{{ name }}</strong><span><span class="wb-file-badge">{{ extensionLabel }}</span><span class="wb-file-label">{{ label }}</span></span></div>
            <div class="wb-preview-actions">
              <button v-if="hasToolbar" type="button" class="wb-button wb-toolbar-toggle" :class="{ 'is-active': toolbar }" :aria-label="toolbar ? t('隐藏工具栏', 'Hide toolbar') : t('显示工具栏', 'Show toolbar')" :aria-expanded="toolbar" aria-controls="wb-preview-content" @click="toolbar = !toolbar"><WorkbenchIcon name="sliders" /><span>{{ t('工具栏', 'Toolbar') }}</span></button>
              <button type="button" class="wb-icon-button" :class="{ 'is-active': detailsOpen }" :aria-label="t('文件详情', 'File details')" :aria-expanded="detailsOpen" :aria-controls="detailId" @click="detailsOpen = !detailsOpen"><WorkbenchIcon name="info" /></button>
            </div>
          </header>
          <div v-if="thirdPartySource" class="wb-source-notice" role="note" :aria-label="t('第三方资源来源', 'Third-party resource source')">
            <WorkbenchIcon name="link" />
            <div><strong>{{ t('资源来自第三方站点', 'This resource comes from a third-party site') }}</strong><p>{{ t('来源：', 'Source: ') }}<a :href="thirdPartySource.url" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">{{ thirdPartySource.origin }}</a><span>{{ t('。文件内容由来源站点提供。', '. File content is provided by the source site.') }}</span></p></div>
          </div>
          <p v-if="error" class="wb-note is-error" role="alert">{{ error }}</p>
          <div id="wb-preview-content" class="wb-preview-stage"><slot /></div>
          <footer class="wb-preview-footer">
            <span class="wb-status" :class="{ 'is-ready': ready && !error, 'is-error': error }" role="status"><i></i>{{ status }}</span>
            <span v-if="warningCount" class="wb-warning-count">{{ t(`${warningCount} 条提示`, `${warningCount} notice${warningCount === 1 ? '' : 's'}`) }}</span>
            <div v-if="timings.length" class="wb-runtime-timings" :aria-label="t('此次预览耗时', 'Preview timings')"><span v-for="timing in timings" :key="timing.label"><small>{{ timing.label }}</small><strong>{{ timing.value }}</strong></span></div>
          </footer>
        </section>
        <footer class="wb-workspace-footer"><span><WorkbenchIcon name="lock" />{{ t('浏览器内处理', 'Processed in your browser') }}</span><span>{{ t('也可以将文件拖到这里打开', 'Drop files here to open them') }} <span class="wb-drop-key">↵</span></span></footer>

        <aside v-if="detailsOpen" :id="detailId" class="wb-details" :aria-label="t('文件详情', 'File details')">
          <header><h2>{{ t('文件详情', 'File details') }}</h2><button class="wb-icon-button" type="button" :aria-label="t('关闭文件详情', 'Close file details')" @click="detailsOpen = false"><WorkbenchIcon name="close" /></button></header>
          <p class="wb-detail-filename">{{ name }}</p>
          <dl class="wb-file-facts"><div><dt>{{ t('格式', 'Format') }}</dt><dd>{{ extensionLabel }}</dd></div><div><dt>{{ t('来源', 'Source') }}</dt><dd>{{ sourceLabel }}</dd></div><div><dt>{{ t('预览驱动', 'Preview driver') }}</dt><dd>{{ family }}</dd></div></dl>
          <section v-if="modelSummary.length" class="wb-detail-section"><h3>{{ t('3D 元数据', '3D metadata') }}</h3><dl class="wb-file-facts"><div v-for="row in modelSummary" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div></dl></section>
          <slot name="diagnostics" />
        </aside>
      </div>
      <AgentWorkbench v-if="agentOpened" v-show="section === 'agent'" />
    </div>

    <dialog ref="linkDialog" class="wb-link-dialog" aria-labelledby="wb-link-heading" @click="event => { if (event.target === linkDialog) closeLink(); }" @cancel.prevent="closeLink">
      <form class="wb-remote" @submit.prevent="openRemote">
        <header><div class="wb-dialog-icon"><WorkbenchIcon name="link" /></div><button class="wb-icon-button" type="button" :aria-label="t('关闭链接窗口', 'Close link dialog')" @click="closeLink"><WorkbenchIcon name="close" /></button></header>
        <h2 id="wb-link-heading">{{ t('打开一个文件链接', 'Open a file link') }}</h2><p>{{ t('粘贴可直接访问的 HTTP(S) 文件地址。第三方文件会标明来源，来源站点需允许跨域访问。', 'Paste a direct HTTP(S) file URL. Third-party files are labeled with their source, which must allow cross-origin access.') }}</p>
        <label for="wb-remote-url">{{ t('文件 URL', 'File URL') }}</label><input id="wb-remote-url" ref="linkInput" v-model="remoteUrl" type="url" class="wb-remote-input" placeholder="https://example.com/document.pdf" required />
        <button type="submit" class="wb-button wb-remote-button">{{ t('打开预览', 'Open preview') }} <WorkbenchIcon name="chevron" /></button>
      </form>
    </dialog>
    <div v-if="dragDepth > 0" class="wb-drop-overlay"><div><WorkbenchIcon name="upload" /><strong>{{ t('松开，打开文件', 'Drop to open files') }}</strong><span>{{ t('多个文件可一同导入，自动关联资源。', 'Import multiple files together to link related resources.') }}</span></div></div>
  </main>
</template>

<style src="./workbench.css"></style>
