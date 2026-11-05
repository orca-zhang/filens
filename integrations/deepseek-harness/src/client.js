import { createElement, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import styles from './client.css';
import viewerStyles from './viewer.css';
import { mountViewer } from './viewer.js';

export const name = 'filens-preview';
export const inject = ['documentPreviews', 'slots'];
const id = 'dsh-filens';
const extensions = __FILENS_EXTENSIONS__;
const binaryExtensions = __FILENS_BINARY_EXTENSIONS__;
const runtimePath = __FILENS_RUNTIME_PATH__;

export function runtimeUrl(base, file = 'filens.js') {
  return new URL(`${runtimePath.slice(1)}${file}`, base).href;
}

const resources = new Map();
function acquireRuntime(base) {
  const url = runtimeUrl(base);
  let entry = resources.get(url);
  if (!entry) {
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet'; sheet.href = runtimeUrl(base, __FILENS_RUNTIME_STYLES__);
    sheet.dataset.filensRuntime = '';
    const styled = new Promise((resolve, reject) => {
      sheet.onload = resolve;
      sheet.onerror = () => reject(new Error('The preview stylesheet could not be loaded.'));
    });
    document.head.append(sheet);
    entry = { sheet, refs: 0, ready: Promise.all([import(url), styled]).then(([module]) => module) };
    resources.set(url, entry);
  }
  entry.refs++;
  return { ready: entry.ready, release() {
    if (--entry.refs === 0) { entry.sheet.remove(); resources.delete(url); }
  } };
}

// Body and header actions share only the current tab's live viewer, never bytes.
const views = new Map();
const listeners = new Set();
function publish(key, value) {
  if (value) views.set(key, value); else views.delete(key);
  for (const listener of listeners) listener();
}
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };

function runtimeBase() {
  if (globalThis.location?.protocol === 'http:' || globalThis.location?.protocol === 'https:') return document.baseURI;
  return globalThis.__FILENS_DSH_PREVIEW_ORIGIN__ ?? globalThis.__DSH_TRANSPORT__?.streamBaseUrl;
}

function filename(address) {
  const last = address.split('/').at(-1) ?? 'document';
  try { return decodeURIComponent(last); } catch { return last; }
}

const words = {
  en: {
    loading: 'Opening preview', slow: 'Larger files can take a little longer.',
    failed: 'Unable to open preview', retry: 'Try again', details: 'Show details',
    hint: 'You can also choose another viewer from the menu above.',
    timeout: 'The preview is taking too long. Try opening it again.',
    host: 'The preview service is unavailable. Reload DSH after enabling the plugin.',
    bytes: 'The complete file has not been loaded.',
  },
  zh: {
    loading: '正在打开预览', slow: '较大的文件可能需要更长时间。',
    failed: '暂时无法预览', retry: '重新尝试', details: '查看详情',
    hint: '也可以通过上方菜单选择其他预览方式。',
    timeout: '预览用时较长，请重新尝试。',
    host: '预览服务暂不可用，启用插件后请重新加载 DSH。',
    bytes: '文件尚未完整加载。',
  },
};

function appearance() {
  const style = getComputedStyle(document.body);
  const dark = document.body.hasAttribute('data-ds-dark-theme');
  const token = (name, fallback) => style.getPropertyValue(`--dsw-alias-${name}`).trim() || fallback;
  return {
    locale: document.documentElement.lang || navigator.language || 'en',
    dark,
    colors: {
      panel: token('bg-base', dark ? '#202126' : '#ffffff'),
      surface: token('bg-document-preview', dark ? '#17181c' : '#f5f6f8'),
      text: token('label-primary', dark ? '#e6e7eb' : '#292b31'),
      muted: token('label-secondary', dark ? '#a2a5ae' : '#777b86'),
      border: token('border-primary', dark ? '#36383f' : '#e6e8ed'),
      accent: token('state-business-primary', dark ? '#7aaaff' : '#4176e6'),
    },
    font: style.fontFamily,
  };
}

function useAppearance() {
  const [value, setValue] = useState(appearance);
  useEffect(() => {
    const refresh = () => {
      const next = appearance();
      setValue(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const observer = new MutationObserver(refresh);
    const options = { attributes: true, attributeFilter: ['lang', 'style', 'class', 'data-ds-dark-theme'] };
    observer.observe(document.documentElement, options);
    observer.observe(document.body, options);
    refresh();
    return () => observer.disconnect();
  }, []);
  return value;
}

function PreviewIcon({ error }) {
  return createElement('svg', { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
    createElement('path', { d: 'M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M14 3v6h6' }),
    createElement('path', { d: error ? 'M12 12v3m0 3h.01' : 'M8 13h8m-8 4h5', strokeLinecap: 'round' }));
}

export function FilensBody(props) {
  const host = useRef(null);
  const activeViewer = useRef(null);
  const [state, setState] = useState({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const theme = useAppearance();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const text = words[theme.locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'];
  const bytes = props.content?.kind === 'bytes' ? props.content.data : undefined;
  const base = runtimeBase();
  const { tab } = props.useTabInfo();
  const key = tab.id;
  useEffect(() => {
    if (!base || !bytes) return;
    let mounted = true, viewer, currentState;
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => { if (mounted) setState({ phase: 'error', code: 'timeout' }); }, 60000);
    const slowTimer = setTimeout(() => { if (mounted) setSlow(true); }, 8000);
    const finish = next => {
      if (!mounted) return;
      clearTimeout(timer); clearTimeout(slowTimer);
      setState({ ...next, bytes, address: props.resourceAddress, attempt });
    };
    setState({ phase: 'loading', bytes, address: props.resourceAddress, attempt }); setSlow(false);
    const runtime = acquireRuntime(base);
    runtime.ready.then(({ createPreview }) => {
      if (!mounted) return;
      host.current.dataset.requestId = requestId;
      viewer = mountViewer(host.current, createPreview, {
        // Workers may transfer their input; DSH retains ownership of its bytes.
        bytes: bytes.slice(), name: filename(props.resourceAddress), appearance: themeRef.current,
      }, {
        onStateChange: value => { currentState = value; if (mounted && viewer) publish(key, { viewer, state: value }); },
        onRendered: () => finish({ phase: 'ready' }),
        onInteractive: () => finish({ phase: 'interactive' }),
        onError: error => finish({ phase: 'error', message: error.message }),
      });
      activeViewer.current = viewer;
      publish(key, { viewer, state: currentState ?? viewer.getState() });
    }).catch(error => finish({ phase: 'error', message: error.message }));
    return () => {
      mounted = false; clearTimeout(timer); clearTimeout(slowTimer);
      viewer?.destroy(); activeViewer.current = null;
      publish(key, undefined); runtime.release();
    };
  }, [base, bytes, props.resourceAddress, key, attempt]);
  useEffect(() => { activeViewer.current?.updateAppearance(theme); }, [theme]);
  const unavailable = !base ? 'host' : !bytes ? 'bytes' : undefined;
  const phase = unavailable ? 'error'
    : state.bytes !== bytes || state.address !== props.resourceAddress || state.attempt !== attempt ? 'loading' : state.phase;
  const variables = Object.fromEntries(Object.entries(theme.colors).map(([key, value]) => [`--filens-${key}`, value]));
  const file = filename(props.resourceAddress);
  return createElement('div', {
    className: 'filens-dsh', 'data-phase': phase, 'aria-busy': phase === 'loading',
    style: { ...variables, fontFamily: theme.font, colorScheme: theme.dark ? 'dark' : 'light' },
  },
    createElement('div', { ref: host, className: 'filens-dsh-view' }),
    phase === 'loading' || phase === 'error' ? createElement('div', { className: 'filens-dsh-state', role: phase === 'error' ? 'alert' : 'status', 'aria-live': 'polite' },
      createElement('div', { className: 'filens-dsh-state-content' },
        createElement('div', { className: 'filens-dsh-file-icon' }, createElement(PreviewIcon, { error: phase === 'error' })),
        createElement('strong', null, phase === 'error' ? text.failed : text.loading),
        createElement('span', { className: 'filens-dsh-filename', title: file }, file),
        phase === 'loading' ? createElement('div', { className: 'filens-dsh-progress', 'aria-hidden': true }, createElement('span')) : null,
        phase === 'loading' && slow ? createElement('p', null, text.slow) : null,
        phase === 'error' ? createElement('p', null, unavailable ? text[unavailable] : state.code ? text[state.code] : text.hint) : null,
        phase === 'error' && state.message ? createElement('details', null,
          createElement('summary', null, text.details), createElement('p', null, state.message)) : null,
        phase === 'error' && !unavailable ? createElement('button', { type: 'button', onClick: () => setAttempt(value => value + 1) }, text.retry) : null,
      )) : null);
}


export function FilensActions(props) {
  const { tab } = props.useTabInfo();
  const entry = useSyncExternalStore(subscribe, () => views.get(tab.id));
  const target = useRef(null);
  const theme = useAppearance();
  const zh = theme.locale.toLowerCase().startsWith('zh');
  useEffect(() => {
    const controls = entry?.viewer.controls;
    if (!controls || !target.current) return;
    target.current.append(controls);
    return () => controls.remove();
  }, [entry?.viewer]);
  return createElement('div', { ref: target, className: 'filens-dsh-actions', role: 'group', 'aria-label': zh ? '预览控件' : 'Preview controls' });
}

export function apply(ctx) {
  ctx.effect(() => {
    const sheet = document.createElement('style');
    sheet.textContent = styles + viewerStyles;
    document.head.append(sheet);
    return () => sheet.remove();
  });
  ctx.effect(() => ctx.documentPreviews.register({
    id, extensions, binaryExtensions, priority: 'extension', title: () => 'FiLens', loading: 'bytes-complete', wrap: false,
  }));
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document.action', () => ctx.slots.register({ name: 'sidebar.right.tab.document.action', key: id }, FilensActions)));
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({ name: 'sidebar.right.tab.document', key: id }, FilensBody)));
}
