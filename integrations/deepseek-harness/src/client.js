import { createElement, useEffect, useRef, useState } from 'react';
import styles from './client.css';

export const name = 'filens-preview';
export const inject = ['documentPreviews', 'slots'];
const id = 'dsh-filens';
const extensions = __FILENS_EXTENSIONS__;
const binaryExtensions = __FILENS_BINARY_EXTENSIONS__;
const runtimePath = __FILENS_RUNTIME_PATH__;

export function viewerUrl(base, parentOrigin, channel) {
  const url = new URL(`${runtimePath.slice(1)}viewer.html`, base);
  url.searchParams.set('parent', parentOrigin);
  url.hash = channel;
  return url.href;
}

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
    bytes: 'The complete file has not been loaded.', frame: 'The preview could not be loaded.',
  },
  zh: {
    loading: '正在打开预览', slow: '较大的文件可能需要更长时间。',
    failed: '暂时无法预览', retry: '重新尝试', details: '查看详情',
    hint: '也可以通过上方菜单选择其他预览方式。',
    timeout: '预览用时较长，请重新尝试。',
    host: '预览服务暂不可用，启用插件后请重新加载 DSH。',
    bytes: '文件尚未完整加载。', frame: '预览界面加载失败。',
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
  const iframe = useRef(null);
  const [state, setState] = useState({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [slow, setSlow] = useState(false);
  const [channel] = useState(() => crypto.randomUUID());
  const theme = useAppearance();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const text = words[theme.locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'];
  const bytes = props.content?.kind === 'bytes' ? props.content.data : undefined;
  const base = runtimeBase();
  const src = base ? viewerUrl(base, globalThis.location.origin, channel) : undefined;
  useEffect(() => {
    if (!src || !bytes) return;
    let mounted = true;
    let sent = false;
    const requestId = crypto.randomUUID();
    const targetOrigin = new URL(src).origin;
    const timer = setTimeout(() => { if (mounted) setState({ phase: 'error', code: 'timeout' }); }, 60000);
    const slowTimer = setTimeout(() => { if (mounted) setSlow(true); }, 8000);
    const receive = event => {
      if (!mounted || event.source !== iframe.current?.contentWindow || event.origin !== targetOrigin || event.data?.channel !== channel) return;
      if (event.data.type === 'filens:ready' && !sent) {
        sent = true;
        // The transfer owns a copy, leaving DSH’s retained preview bytes intact.
        const copy = bytes.slice();
        iframe.current.contentWindow.postMessage({ type: 'filens:open', channel, requestId, bytes: copy, name: filename(props.resourceAddress), appearance: themeRef.current }, targetOrigin, [copy.buffer]);
      }
      if (event.data.requestId !== requestId) return;
      if (['filens:rendered', 'filens:interactive', 'filens:error'].includes(event.data.type)) {
        clearTimeout(timer);
        clearTimeout(slowTimer);
        setState(event.data.type === 'filens:error'
          ? { phase: 'error', message: String(event.data.message || '') }
          : { phase: event.data.type === 'filens:interactive' ? 'interactive' : 'ready' });
      }
    };
    setState({ phase: 'loading' });
    setSlow(false);
    addEventListener('message', receive);
    iframe.current?.contentWindow?.postMessage({ type: 'filens:hello', channel }, targetOrigin);
    return () => { mounted = false; clearTimeout(timer); clearTimeout(slowTimer); removeEventListener('message', receive); };
  }, [src, bytes, props.resourceAddress, channel, attempt]);
  useEffect(() => {
    if (src) iframe.current?.contentWindow?.postMessage({ type: 'filens:appearance', channel, appearance: theme }, new URL(src).origin);
  }, [src, channel, theme, attempt]);
  const unavailable = !src ? 'host' : !bytes ? 'bytes' : undefined;
  const phase = unavailable ? 'error' : state.phase;
  const variables = Object.fromEntries(Object.entries(theme.colors).map(([key, value]) => [`--filens-${key}`, value]));
  const file = filename(props.resourceAddress);
  return createElement('div', {
    className: 'filens-dsh', 'data-phase': phase, 'aria-busy': phase === 'loading',
    style: { ...variables, fontFamily: theme.font, colorScheme: theme.dark ? 'dark' : 'light' },
  },
    src && bytes ? createElement('iframe', {
      // Local password dialogs submit forms; CSP still prevents form navigation.
      key: attempt, ref: iframe, src, title: 'FiLens preview', sandbox: 'allow-scripts allow-same-origin allow-downloads allow-forms',
      allowFullScreen: true,
      onError: () => setState({ phase: 'error', code: 'frame' }),
    }) : null,
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

export function apply(ctx) {
  ctx.effect(() => {
    const sheet = document.createElement('style');
    sheet.textContent = styles;
    document.head.append(sheet);
    return () => sheet.remove();
  });
  ctx.effect(() => ctx.documentPreviews.register({
    id, extensions, binaryExtensions, priority: 'extension', title: () => 'FiLens', loading: 'bytes-complete', wrap: false,
  }));
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({ name: 'sidebar.right.tab.document', key: id }, FilensBody)));
}
