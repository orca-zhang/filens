import { createElement as h, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FilensBody, FilensActions, useAppearance } from './preview.js';
import { relatedFiles } from './related-files.js';
import { isTemporaryFile, shortSessionTitle, isMissingFile } from './session-files.js';

// Keep browser-selected files across panel navigation; release them on unload.
const empty = () => ({ files: [], active: null, scan: { done: 0, total: 0, loading: false, errors: [], started: false } });
let snapshot = empty();
const listeners = new Set();
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
function update(patch) { snapshot = { ...snapshot, ...patch }; for (const listener of listeners) listener(); }
export function clearWorkspace() { update(empty()); }
export function setSessionFiles(state, reader) {
  if (state.error) { update({ scan: { ...snapshot.scan, loading: false, error: state.error } }); return; }
  if (state.done === 0 && state.total > 0) { update({ scan: { ...state, files: undefined, loading: true, started: true } }); return; }
  const previous = new Map(snapshot.files.map(entry => [entry.id, entry]));
  const files = state.files.map(entry => {
    const extension = entry.name.includes('.') ? entry.name.split('.').at(-1).toLowerCase() : '';
    return { ...entry, size: entry.size ?? previous.get(entry.id)?.size, extension, kind: kindOf(extension), read: previous.get(entry.id)?.read ?? reader(entry),
      file: previous.get(entry.id)?.file ?? { name: entry.name, size: entry.size, lastModified: entry.origins.at(-1)?.time } };
  });
  update({ files: [...files, ...snapshot.files.filter(entry => !entry.origins)],
    scan: { ...state, files: undefined, loading: state.done < state.total, started: true } });
}

const paths = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  plus: 'M12 5v14 M5 12h14', search: 'M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  arrow: 'M5 12h14 M13 6l6 6-6 6', back: 'M19 12H5 M11 6l-6 6 6 6',
  file: 'M14 2H6a2 2 0 0 0-2 2v16h16V8z M14 2v6h6 M8 13h8 M8 17h5',
  code: 'M14 2H6a2 2 0 0 0-2 2v16h16V8z M14 2v6h6 M9 12l-3 3 3 3 M15 12l3 3-3 3',
  archive: 'M14 2H6a2 2 0 0 0-2 2v16h16V8z M14 2v6h6 M10 5h2 M10 9h2 M10 13h2 M10 17h2',
  table: 'M3 3h18v18H3z M3 9h18 M3 15h18 M9 9v12 M15 9v12',
  slides: 'M3 3h18v13H3z M12 16v5 M7 21l5-5 5 5 M7 7h6 M7 11h10',
  audio: 'M9 18V5l12-2v13 M9 8l12-2 M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3 M21 16a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3',
  video: 'M3 4h18v16H3z M3 8h18 M3 16h18 M7 4v4 M17 4v4 M7 16v4 M17 16v4 M10 10l5 2-5 2z',
  cube: 'M12 2l9 5v10l-9 5-9-5V7z M3 7l9 5 9-5 M12 12v10 M7 4.8l9 5',
  image: 'M3 3h18v18H3z M3 17l6-6 4 4 3-3 5 5 M15 7h.01',
  list: 'M8 5h13 M8 12h13 M8 19h13 M3 5h.01 M3 12h.01 M3 19h.01',
  info: 'M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  close: 'M6 6l12 12 M6 18L18 6', check: 'M5 12l4 4L19 6',
  upload: 'M12 16V3 M7 8l5-5 5 5 M4 16v5h16v-5', refresh: 'M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 13 3 M18 18a8 8 0 0 1-13-3',
};
export function WorkspaceIcon({ name = 'file', size = 20 }) {
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] ?? paths.file }));
}

const kinds = {
  document: { zh: '文档', en: 'Documents', icon: 'file', color: 'blue' },
  image: { zh: '图像', en: 'Images', icon: 'image', color: 'rose' },
  model: { zh: '三维 / CAD', en: '3D / CAD', icon: 'cube', color: 'green' },
  other: { zh: '其他', en: 'Other', icon: 'file', color: 'sand' },
};
const relatedLabels = {
  message: ['同一条消息', 'Same message'], question: ['同一提问', 'Same question'],
  directory: ['同一目录', 'Same folder'], session: ['同一会话', 'Same session'],
};
function kindOf(extension) {
  if (/^(pdf|docx?|pptx?|xlsx?|csv|pages|numbers|key|odt|ods|odp|rtf|txt|md|epub)$/.test(extension)) return 'document';
  if (/^(png|jpe?g|webp|avif|gif|bmp|svg|heic|heif|tiff?|dng|cr2|nef)$/.test(extension)) return 'image';
  if (/^(step|stp|stl|obj|glb|gltf|fbx|3ds|ply|dxf|dwg|iges|igs)$/.test(extension)) return 'model';
  return 'other';
}
function sizeLabel(bytes) {
  if (bytes === undefined) return '—';
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
}
function rememberSize(id, size) {
  const entry = snapshot.files.find(item => item.id === id);
  if (entry && entry.file.size === undefined && entry.size !== size) {
    update({ files: snapshot.files.map(item => item.id === id ? { ...item, size } : item) });
  }
}

const thumbnailFormats = new Set(__FILENS_BINARY_EXTENSIONS__);
function fileIcon(entry) {
  if (/^(zipx?|rar|7z|tar|gz|bz2|xz|tgz|zst)$/.test(entry.extension)) return 'archive';
  if (/^(xlsx?|xlsm|ods|numbers|csv|tsv)$/.test(entry.extension)) return 'table';
  if (/^(pptx?|pptm|odp|key)$/.test(entry.extension)) return 'slides';
  if (/^(mp3|wav|flac|aac|m4a|ogg|oga|opus)$/.test(entry.extension)) return 'audio';
  if (/^(mp4|mov|m4v|webm|mkv|avi|mpeg|mpg|ogv)$/.test(entry.extension)) return 'video';
  if (entry.kind === 'other' && entry.extension && !thumbnailFormats.has(entry.extension)) return 'code';
  return kinds[entry.kind].icon;
}
function FileSymbol({ entry }) {
  // Same folded-page shape as the demo's FileFormatIcon, without a Vue runtime.
  return h('span', { className: 'fw-file-symbol', 'data-icon': fileIcon(entry), 'data-extension': entry.extension, 'aria-hidden': true },
    h('svg', { viewBox: '0 0 64 72', fill: 'none' },
      h('path', { d: 'M15 3h26l14 14v47a5 5 0 0 1-5 5H15a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Z', fill: 'currentColor', fillOpacity: .12 }),
      h('path', { d: 'M41 3v10a4 4 0 0 0 4 4h10', fill: 'currentColor', fillOpacity: .25 }),
      h('path', { d: 'M23 26h18M23 33h18M23 40h11', stroke: 'currentColor', strokeOpacity: .4, strokeWidth: 2, strokeLinecap: 'round' })),
    h('span', null, entry.extension.toUpperCase() || 'FILE'));
}

function FilePreview({ entry, thumbnail = false }) {
  const [source, setSource] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const host = useRef(null);
  const [visible, setVisible] = useState(!thumbnail);
  const { locale } = useAppearance();
  const zh = locale.toLowerCase().startsWith('zh');
  const read = !thumbnail || thumbnailFormats.has(entry.extension);
  useEffect(() => {
    if (!thumbnail) return;
    const observer = new IntersectionObserver(([item]) => setVisible(item.isIntersecting), { rootMargin: '100px' });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [thumbnail]);
  useEffect(() => {
    if (!visible || !read) { setSource(null); return; }
    let cancelled = false;
    const controller = new AbortController();
    Promise.resolve().then(() => entry.read ? entry.read(controller.signal) : entry.file.arrayBuffer())
      .then(buffer => {
        if (cancelled) return;
        const bytes = new Uint8Array(buffer);
        setSource({ id: entry.id, bytes });
        rememberSize(entry.id, bytes.byteLength);
      })
      .catch(error => {
        if (cancelled) return;
        if (entry.origins && isMissingFile(error)) {
          update({ files: snapshot.files.filter(file => file.id !== entry.id), active: snapshot.active === entry.id ? null : snapshot.active });
        } else setSource({ id: entry.id, error: error.message });
      });
    return () => { cancelled = true; controller.abort(); };
  }, [entry.id, entry.file, visible, read, attempt]);
  const error = source?.id === entry.id && source.error;
  return h('div', { ref: host, className: 'fw-source' },
    !thumbnail && error ? h('div', { className: 'fw-read-error', role: 'alert' }, h(FileSymbol, { entry }),
      h('strong', null, zh ? '暂时无法读取文件' : 'Unable to read this file'),
      h('p', null, zh ? '文件可能已移动、删除，或当前没有读取权限。' : 'The file may have moved, been deleted, or be inaccessible.'),
      h('button', { type: 'button', className: 'fw-button', onClick: () => setAttempt(value => value + 1) }, zh ? '重新尝试' : 'Try again'),
      h('details', null, h('summary', null, zh ? '查看详情' : 'Show details'), h('p', null, error)))
      : visible && read && source?.id === entry.id && !error ? h(FilensBody, {
        content: { kind: 'bytes', data: source.bytes }, resourceAddress: `/${encodeURIComponent(entry.file.name)}`,
        useTabInfo: () => ({ tab: { id: `${thumbnail ? 'tile' : 'workspace'}-${entry.id}` } }),
      }) : null,
    thumbnail || !source ? h('div', { className: 'fw-preview-placeholder', 'data-state': error ? 'unavailable' : read ? 'loading' : 'icon' },
      h(FileSymbol, { entry }), error ? h('small', null, zh ? '无法读取' : 'Unavailable') : null) : null);
}

function FileBadge({ entry }) {
  return h('span', { className: `fw-file-badge fw-${kinds[entry.kind].color}` }, entry.extension.toUpperCase() || 'FILE');
}

export function FilensWorkspace({ refresh, locate }) {
  const { files, active, scan } = useSyncExternalStore(subscribe, () => snapshot);
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');
  const [layout, setLayout] = useState('grid');
  const [info, setInfo] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [source, setSource] = useState('all');
  const [sessionId, setSessionId] = useState('all');
  const [expanded, setExpanded] = useState({});
  const [showTemporary, setShowTemporary] = useState(false);
  const picker = useRef(null);
  const back = useRef(null);
  const root = useRef(null);
  const previousFile = useRef(null);
  const theme = useAppearance();
  const zh = theme.locale.toLowerCase().startsWith('zh');
  const t = (cn, en) => zh ? cn : en;
  const temporaryFiles = useMemo(() => new Set(files.filter(entry => entry.origins && isTemporaryFile(entry)).map(entry => entry.id)), [files]);
  const visibleFiles = useMemo(() => showTemporary ? files : files.filter(entry => !temporaryFiles.has(entry.id)), [files, showTemporary, temporaryFiles]);
  const selected = visibleFiles.find(item => item.id === active);
  const related = useMemo(() => relatedFiles(selected, visibleFiles), [selected, visibleFiles]);
  const filtered = visibleFiles.filter(entry => (category === 'all' || category === entry.kind)
    && (source === 'all' || (source === 'session' ? entry.origins : !entry.origins))
    && (sessionId === 'all' || entry.origins?.some(origin => origin.sessionId === sessionId))
    && `${entry.file.name} ${entry.path ?? ''} ${entry.origins?.map(origin => `${origin.sessionTitle} ${origin.excerpt}`).join(' ') ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  const sessions = new Map(visibleFiles.flatMap(entry => entry.origins ?? []).map(origin => [origin.sessionId, origin.sessionTitle]));
  const groups = new Map();
  for (const entry of filtered) {
    const sources = new Map(entry.origins?.filter(origin => sessionId === 'all' || origin.sessionId === sessionId).map(origin => [origin.sessionId, origin.sessionTitle]));
    if (!entry.origins) sources.set(null, t('本机文件', 'Local files'));
    for (const [id, title] of sources) {
      const key = id === null ? 'local' : `session:${id}`;
      if (!groups.has(key)) groups.set(key, { id: key, title, files: [] });
      groups.get(key).files.push({ ...entry, origins: entry.origins?.filter(origin => origin.sessionId === id) });
    }
  }
  const groupOpen = group => expanded[group.id] ?? (group.id === 'local' || Boolean(query.trim()) || sessionId !== 'all');
  useEffect(() => { if (!snapshot.scan.started) refresh(); }, [refresh]);
  function addFiles(incoming) {
    const entries = [...incoming].map(file => {
      const extension = file.name.includes('.') ? file.name.split('.').at(-1).toLowerCase() : '';
      return { id: crypto.randomUUID(), file, extension, kind: kindOf(extension) };
    });
    update({ files: [...snapshot.files, ...entries] });
  }
  useEffect(() => {
    if (!selected) {
      [...root.current?.querySelectorAll('[data-file-id]') ?? []].find(element => element.dataset.fileId === previousFile.current && element.getClientRects().length)?.focus();
      return;
    }
    previousFile.current = selected.id;
    const backButton = back.current?.getClientRects().length ? back.current : root.current?.querySelector('.fw-mobile-back');
    backButton?.focus();
    const close = event => {
      if (event.key === 'Escape' && !document.fullscreenElement && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)
          && ![...document.querySelectorAll('dialog[open], [role="dialog"], .pptxv-model-tools:not([hidden]), details[open]')].some(element => {
            // DSH keeps its narrow-window navigation dialog mounted offscreen.
            const rect = element.getBoundingClientRect();
            return element.checkVisibility() && rect.width > 0 && rect.height > 0
              && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
          })) {
        if (root.current?.querySelector('.fw-inspector')) {
          setInfo(false);
          root.current.querySelector('.fw-info-toggle')?.focus();
        } else update({ active: null });
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selected?.id]);
  const openButton = h('button', { type: 'button', className: 'fw-button fw-primary', onClick: () => picker.current.click() }, h(WorkspaceIcon, { name: 'plus', size: 17 }), t('打开文件', 'Open files'));
  const nav = entry => h('button', {
    type: 'button', key: entry.id, className: `fw-file-row ${active === entry.id ? 'is-active' : ''}`,
    onClick: () => update({ active: entry.id }), 'aria-current': active === entry.id ? 'true' : undefined, title: entry.file.name,
  }, h('span', { className: `fw-row-icon fw-${kinds[entry.kind].color}` }, h(WorkspaceIcon, { name: fileIcon(entry), size: 18 })),
  h('span', { className: 'fw-row-copy' }, h('strong', null, entry.file.name), h('small', null, `${entry.extension.toUpperCase()} · ${sizeLabel(entry.file.size ?? entry.size)}`)));
  const fileCard = entry => h('article', { className: 'fw-card', key: entry.id },
    h('div', { className: `fw-thumb fw-${kinds[entry.kind].color}`, 'aria-hidden': true, inert: '' }, h(FilePreview, { entry, thumbnail: true })),
    h('div', { className: 'fw-card-copy' }, h('span', { className: `fw-card-icon fw-${kinds[entry.kind].color}` }, h(WorkspaceIcon, { name: fileIcon(entry), size: 19 })),
      h('div', null, h('button', { type: 'button', className: 'fw-card-open', 'data-file-id': entry.id, onClick: () => update({ active: entry.id }), title: entry.file.name }, entry.file.name),
        h('p', null, entry.extension.toUpperCase(), h('span', null, '·'), sizeLabel(entry.file.size ?? entry.size)),
        entry.origins ? h('button', { type: 'button', className: 'fw-card-origin', title: `${entry.origins[0].sessionTitle}\n${entry.origins[0].excerpt}`, onClick: () => locate(entry.origins[0]) }, shortSessionTitle(entry.origins[0].sessionTitle), entry.origins.length > 1 ? ` +${entry.origins.length - 1}` : '') : null)),
    h('span', { className: 'fw-card-type' }, entry.extension.toUpperCase()));

  return h('section', {
    ref: root, className: `fw-workspace ${theme.dark ? 'fw-dark' : ''} ${selected ? 'fw-reading' : ''} ${dragging ? 'fw-dragging' : ''}`,
    'aria-label': t('文件工作台', 'File workspace'),
    onDragOver: event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } },
    onDragLeave: event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); },
    onDrop: event => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); },
  },
  h('input', { ref: picker, type: 'file', multiple: true, hidden: true, 'aria-label': t('选择要预览的文件', 'Choose files to preview'), onChange: event => { addFiles(event.target.files); event.target.value = ''; } }),
  h('header', { className: 'fw-appbar', 'data-window-drag': '' },
    h('div', { className: 'fw-brand' }, h(WorkspaceIcon, { name: 'grid', size: 18 }), h('h1', null, t('文件工作台', 'File workspace'))),
    h('div', { className: 'fw-appbar-end' }, h('button', { type: 'button', className: 'fw-button', onClick: refresh, disabled: scan.loading }, h(WorkspaceIcon, { name: 'refresh', size: 15 }), t('刷新会话文件', 'Refresh session files')), openButton)),
  selected ? h('div', { className: 'fw-reader' },
    h('aside', { className: 'fw-file-nav', 'aria-label': t('已打开的文件', 'Opened files') },
      h('button', { type: 'button', ref: back, className: 'fw-back', onClick: () => update({ active: null }) }, h(WorkspaceIcon, { name: 'back', size: 16 }), t('返回工作台', 'Back to workspace')),
      h('div', { className: 'fw-nav-heading' }, t('本次打开', 'THIS WORKSPACE'), h('span', null, visibleFiles.length)),
      h('div', { className: 'fw-nav-files' }, visibleFiles.map(nav)),
      h('div', { className: 'fw-nav-note' }, h(WorkspaceIcon, { name: 'upload', size: 17 }), t('拖入更多文件', 'Drop more files'))),
    h('main', { className: 'fw-preview-column' },
      h('div', { className: 'fw-reader-header' },
        h('button', { type: 'button', className: 'fw-icon-button fw-mobile-back', 'aria-label': t('返回工作台', 'Back to workspace'), onClick: () => update({ active: null }) }, h(WorkspaceIcon, { name: 'back', size: 18 })),
        h('div', { className: 'fw-reader-title' }, h(FileBadge, { entry: selected }), h('strong', { title: selected.file.name }, selected.file.name)),
        h('button', { type: 'button', className: `fw-icon-button fw-info-toggle ${info ? 'is-active' : ''}`, title: t('文件信息', 'File information'), 'aria-label': t('文件信息', 'File information'), 'aria-expanded': info, 'aria-controls': info ? 'fw-file-details' : undefined, 'aria-pressed': info, onClick: () => setInfo(!info) }, h(WorkspaceIcon, { name: 'info', size: 19 }))),
      h('div', { className: 'fw-stage', key: selected.id }, h(FilePreview, { entry: selected })),
      h('footer', { className: 'fw-reader-footer' }, h('span', { className: 'fw-preview-caption' }, selected.extension.toUpperCase(), h('span', null, '·'), sizeLabel(selected.file.size ?? selected.size)),
        h(FilensActions, { useTabInfo: () => ({ tab: { id: `workspace-${selected.id}` } }) }),
        h('span', { className: 'fw-ready-label' }, h(WorkspaceIcon, { name: 'check', size: 13 }), t('本地文件', 'Local file')))),
    info ? h('aside', { id: 'fw-file-details', className: 'fw-inspector', 'aria-label': t('文件详情', 'File details') },
      h('header', { className: 'fw-inspector-heading' }, h('h2', { title: selected.file.name }, selected.file.name),
        h('button', { type: 'button', className: 'fw-icon-button', 'aria-label': t('收起文件信息', 'Hide file information'), onClick: () => { setInfo(false); root.current?.querySelector('.fw-info-toggle')?.focus(); } }, h(WorkspaceIcon, { name: 'close', size: 18 }))),
      h('div', { className: 'fw-inspector-content', key: selected.id },
      h('div', { className: 'fw-inspector-summary' },
        h('div', { className: 'fw-inspector-symbol' }, h(WorkspaceIcon, { name: fileIcon(selected), size: 28 })),
        h('div', null, h('strong', null, t(kinds[selected.kind].zh, kinds[selected.kind].en)),
          h('p', null, selected.extension.toUpperCase() || 'FILE', h('span', null, ' · '), selected.origins ? t('会话文件', 'Session file') : t('本机文件', 'Local file')))),
      h('section', { className: 'fw-properties' }, h('h3', null, t('属性', 'Properties')), h('dl', null,
        h('dt', null, t('文件大小', 'Size')), h('dd', { 'data-file-size': selected.file.size ?? selected.size }, selected.file.size === undefined && selected.size === undefined ? t('尚未读取', 'Not read yet') : sizeLabel(selected.file.size ?? selected.size)),
        h('dt', null, t('文件格式', 'Format')), h('dd', null, selected.extension.toUpperCase()),
        Number.isFinite(selected.file.lastModified) ? h('dt', null, selected.origins ? t('引用时间', 'Referenced') : t('修改时间', 'Modified')) : null,
        Number.isFinite(selected.file.lastModified) ? h('dd', null, new Intl.DateTimeFormat(theme.locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(selected.file.lastModified)) : null,
        h('dt', null, t('文件来源', 'Source')), h('dd', null, selected.origins ? t('会话记录', 'Session history') : t('本机选择', 'File picker')))),
      selected.path ? h('section', { className: 'fw-location' }, h('h3', null, t('位置', 'Location')), h('p', { className: 'fw-file-path', title: selected.path }, selected.path)) : null,
      h('section', { className: 'fw-related', 'aria-label': t('相关文件', 'Related files') }, h('h3', null, t('相关文件', 'Related files')),
        related.length ? related.map(({ entry, reason }) => h('button', {
          key: entry.id, type: 'button', className: 'fw-related-file', title: entry.path ?? entry.file.name,
          onClick: () => update({ active: entry.id }),
        }, h('span', { className: 'fw-related-art', 'aria-hidden': true },
          h('span', { className: 'fw-mini-preview', inert: '' }, h(FilePreview, { entry, thumbnail: true }))),
        h('span', { className: 'fw-related-copy' }, h('strong', null, entry.file.name), h('small', null, t(...relatedLabels[reason])))))
          : h('p', { className: 'fw-related-empty' }, t('暂无关联文件', 'No related files yet'))),
      selected.origins ? h('section', { className: 'fw-origins' }, h('h3', null, t('来源消息', 'Source messages'), h('span', { className: 'fw-section-count' }, selected.origins.length)),
        selected.origins.map(origin => h('article', { key: `${origin.sessionId}:${origin.seq}`, className: 'fw-origin' },
          h('strong', null, origin.sessionTitle), h('p', null, origin.excerpt || t('附件', 'Attachment')),
          h('div', null, h('button', { type: 'button', onClick: () => locate(origin) }, t('查看所在消息', 'View message')),
            origin.question ? h('button', { type: 'button', onClick: () => locate(origin.question) }, t('查看提问', 'View question')) : null))))
        : h('p', { className: 'fw-inspector-note' }, t('本机选择的文件，刷新后需重新打开。', 'Files selected locally must be reopened after a reload.')))) : null)
  : h('main', { className: 'fw-library' },
    h('div', { className: 'fw-source-toolbar' },
      h('div', { className: 'fw-source-tabs', role: 'group', 'aria-label': t('文件来源', 'File source') },
        [['all', t('全部来源', 'All sources')], ['session', t('会话文件', 'Session files')], ['local', t('本机文件', 'Local files')]].map(([id, label]) => h('button', { key: id, type: 'button', 'aria-pressed': source === id, onClick: () => { setSource(id); setSessionId('all'); } }, label))),
      h('select', { 'aria-label': t('来源会话', 'Source session'), value: sessionId, onChange: event => { setSessionId(event.target.value); setSource('all'); } },
        h('option', { value: 'all' }, t('所有会话', 'All sessions')), [...sessions].map(([id, title]) => h('option', { key: id, value: id, title }, shortSessionTitle(title))))),
    h('div', { className: 'fw-scan-status', role: scan.error || scan.errors.length ? 'alert' : 'status' }, scan.error || (scan.loading ? t(`正在汇集会话文件 ${scan.done}/${scan.total}`, `Collecting session files ${scan.done}/${scan.total}`)
      : t(`已读取 ${scan.total} 个会话 · ${visibleFiles.filter(entry => entry.origins).length} 个会话文件`, `${scan.total} sessions read · ${visibleFiles.filter(entry => entry.origins).length} session files`)),
      temporaryFiles.size ? h('button', { type: 'button', className: 'fw-temporary-toggle', 'aria-pressed': showTemporary, onClick: () => setShowTemporary(value => !value) },
        t(showTemporary ? `隐藏 ${temporaryFiles.size} 个临时文件` : `显示 ${temporaryFiles.size} 个临时文件`, `${showTemporary ? 'Hide' : 'Show'} ${temporaryFiles.size} temporary files`)) : null,
      scan.errors.length ? h('details', null, h('summary', null, t(`${scan.errors.length} 个会话读取失败`, `${scan.errors.length} sessions could not be read`)), scan.errors.map(error => h('p', { key: error.sessionId }, error.title, ': ', error.message))) : null),
    h('div', { className: 'fw-library-toolbar' },
      h('div', { className: 'fw-filters', role: 'group', 'aria-label': t('文件分类', 'File categories') },
        ['all', ...Object.keys(kinds).filter(kind => visibleFiles.some(file => file.kind === kind))].map(kind => h('button', { type: 'button', key: kind, className: category === kind ? 'is-active' : '', 'aria-pressed': category === kind, onClick: () => setCategory(kind) }, kind === 'all' ? t('全部文件', 'All files') : t(kinds[kind].zh, kinds[kind].en), h('span', null, kind === 'all' ? visibleFiles.length : visibleFiles.filter(entry => entry.kind === kind).length)))),
      h('div', { className: 'fw-library-tools' }, h('label', { className: 'fw-search' }, h(WorkspaceIcon, { name: 'search', size: 15 }), h('input', { type: 'search', placeholder: t('查找文件', 'Find a file'), value: query, 'aria-label': t('查找文件', 'Find a file'), onChange: event => setQuery(event.target.value) })),
        h('div', { className: 'fw-layout-toggle', role: 'group', 'aria-label': t('显示方式', 'View layout') }, ['grid', 'list'].map(value => h('button', { type: 'button', key: value, 'aria-label': value === 'grid' ? t('网格视图', 'Grid view') : t('列表视图', 'List view'), 'aria-pressed': layout === value, onClick: () => setLayout(value) }, h(WorkspaceIcon, { name: value, size: 15 })))))),
    files.length ? h('div', { className: `fw-groups fw-groups-${layout}` }, filtered.length ? [...groups.values()].map(group => h('details', {
      key: group.id, className: 'fw-session-group',
      open: groupOpen(group),
      onToggle: event => {
        const open = event.currentTarget.open;
        setExpanded(previous => previous[group.id] === open ? previous : { ...previous, [group.id]: open });
      },
    }, h('summary', null,
      h('span', { className: 'fw-group-art', 'aria-hidden': true, inert: '' }, h('span', { className: 'fw-group-stack', 'data-count': Math.min(group.files.length, 4) },
        [...group.files].sort((a, b) => Number(thumbnailFormats.has(b.extension)) - Number(thumbnailFormats.has(a.extension))).slice(0, 4)
          .map(entry => h('span', { key: entry.id, className: 'fw-mini-preview' }, h(FilePreview, { entry, thumbnail: true }))))),
      h('span', { className: 'fw-group-copy' }, h(WorkspaceIcon, { name: 'grid', size: 19 }),
        h('span', null, h('span', { className: 'fw-group-title', title: group.title }, shortSessionTitle(group.title)),
          h('span', { className: 'fw-group-count' }, t(`${group.files.length} 个文件`, `${group.files.length} files`))),
        h('span', { className: 'fw-group-chevron' }, h(WorkspaceIcon, { name: 'arrow', size: 15 })))),
    groupOpen(group) ? h('div', { className: `fw-files fw-files-${layout}` }, group.files.map(fileCard)) : null)) : h('div', { className: 'fw-no-results' }, t('没有找到匹配的文件。', 'No matching files.')))
      : h('button', { type: 'button', className: 'fw-empty', onClick: () => picker.current.click() }, h(WorkspaceIcon, { name: 'file', size: 28 }), h('strong', null, t('暂无文件', 'No files yet')), h('span', null, t('会话中引用的文件会在这里汇集，也可以打开或拖入本机文件。', 'Files referenced in sessions appear here. You can also open or drop local files.')))),
  h('footer', { className: 'fw-developer' }, h('a', { href: 'https://github.com/orca-zhang/filens', target: '_blank', rel: 'noreferrer' }, 'FiLens')),
  dragging ? h('div', { className: 'fw-drop-overlay' }, h(WorkspaceIcon, { name: 'upload', size: 40 }), h('strong', null, t('松开以添加文件', 'Drop to add files'))) : null);
}
