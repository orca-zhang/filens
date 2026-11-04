import { createPreview } from './filens.js';

const channel = location.hash.slice(1);
const parentOrigin = new URL(location.href).searchParams.get('parent');
let viewer;
let generation = 0;
let requestId;
const host = document.querySelector('#preview');
const send = (type, extra = {}) => {
  // file:// parents have an opaque origin, so only that case needs '*'.
  if (parentOrigin) parent.postMessage({ type, channel, ...extra }, parentOrigin === 'null' ? '*' : parentOrigin);
};

function localizeChrome() {
  const hint = host.querySelector('.model3dv-hint');
  const label = document.documentElement.lang.toLowerCase().startsWith('zh')
    ? '拖拽旋转 · 滚轮缩放 · 双击复位' : 'Drag to orbit · Scroll to zoom · Double-click to reset';
  if (hint && hint.textContent !== label) hint.textContent = label;
}

function fitDocument() {
  const documentView = host.querySelector('.docxv-preview');
  const wrapper = documentView?.querySelector('.docx-wrapper');
  if (!wrapper) return;
  let width = 0;
  for (const page of wrapper.querySelectorAll('.docx')) width = Math.max(width, page.offsetWidth);
  if (!width) return;
  const style = getComputedStyle(documentView);
  const available = documentView.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
  const scale = Math.min(1, Math.max(0.1, available / width));
  const previous = Number(wrapper.style.zoom) || 1;
  if (Math.abs(scale - previous) < 0.0001) return;
  const position = documentView.scrollTop / previous;
  wrapper.style.zoom = String(scale);
  documentView.scrollTop = position * scale;
}

let chromeFrame = 0;
function scheduleChrome() {
  if (chromeFrame) return;
  chromeFrame = requestAnimationFrame(() => {
    chromeFrame = 0;
    localizeChrome();
    fitDocument();
  });
}

function applyAppearance(value) {
  if (!value || typeof value !== 'object') return;
  document.documentElement.dataset.theme = value.dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = value.dark ? 'dark' : 'light';
  for (const key of ['panel', 'surface', 'text', 'muted', 'border', 'accent']) {
    const color = value.colors?.[key];
    if (typeof color === 'string' && CSS.supports('color', color)) document.documentElement.style.setProperty(`--filens-${key}`, color);
  }
  if (typeof value.font === 'string') document.documentElement.style.setProperty('--filens-font', value.font);
  if (typeof value.locale === 'string') {
    document.documentElement.lang = value.locale;
    viewer?.update({ locale: value.locale });
  }
  localizeChrome();
}

// Password entry must stay interactive while document rendering is pending.
let interactiveRequest;
const observer = new MutationObserver(() => {
  scheduleChrome();
  if (requestId && interactiveRequest !== requestId && host.querySelector('.pptxv-password-form')) {
    interactiveRequest = requestId;
    send('filens:interactive', { requestId });
  }
});
observer.observe(host, { childList: true, subtree: true });
const resize = new ResizeObserver(scheduleChrome);
resize.observe(host);

addEventListener('message', event => {
  if (!channel || !parentOrigin || event.source !== parent || event.origin !== parentOrigin || event.data?.channel !== channel) return;
  if (event.data.type === 'filens:hello') { send('filens:ready'); return; }
  if (event.data.type === 'filens:appearance') { applyAppearance(event.data.appearance); return; }
  if (event.data.type !== 'filens:open' || !(event.data.bytes instanceof Uint8Array) || typeof event.data.name !== 'string' || typeof event.data.requestId !== 'string') return;
  const current = ++generation;
  viewer?.destroy();
  viewer = undefined;
  requestId = event.data.requestId;
  host.dataset.requestId = requestId;
  applyAppearance(event.data.appearance);
  const respond = (type, extra) => { if (generation === current) send(type, { requestId: event.data.requestId, ...extra }); };
  try {
    viewer = createPreview('#preview', {
      src: event.data.bytes, name: event.data.name, locale: document.documentElement.lang, toolbar: 'minimal',
      onStateChange: state => {
        if (generation !== current) return;
        const capabilities = state.capabilities ?? {};
        host.dataset.family = state.family;
        host.dataset.page = String(state.pageIndex ?? state.activeSheetIndex ?? state.chapterIndex ?? 0);
        host.dataset.zoom = String(Boolean(capabilities.zoom));
        host.dataset.fullscreen = String(Boolean(capabilities.fullscreen));
        host.dataset.controls = String(Boolean(capabilities.zoom || capabilities.fullscreen));
      },
      onRendered: () => requestAnimationFrame(() => { fitDocument(); respond('filens:rendered'); }),
      onError: error => respond('filens:error', { message: error.message }),
    });
  } catch (error) { respond('filens:error', { message: error instanceof Error ? error.message : String(error) }); }
});
addEventListener('pagehide', () => { ++generation; cancelAnimationFrame(chromeFrame); observer.disconnect(); resize.disconnect(); viewer?.destroy(); viewer = undefined; });
send('filens:ready');
