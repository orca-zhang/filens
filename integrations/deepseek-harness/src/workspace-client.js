import { createElement as h, useEffect, useState } from 'react';
import styles from './client.css';
import viewerStyles from './viewer.css';
import workspaceStyles from './workspace.css';
import { FilensWorkspace, WorkspaceIcon, clearWorkspace, setSessionFiles } from './workspace.js';
import { collectSessionFiles, remoteValue } from './session-files.js';
import { workspaceRemote } from './workspace-remote.js';

export const name = 'filens-workspace';
export const inject = ['slots', 'remote', 'remote.session', 'remote.workspaceFiles', 'sessions', 'uiSession', 'uiWorkspace', 'uiConversation', 'layout'];
const panelId = 'filens-workspace';

export async function apply(ctx) {
  const releaseRemote = await ctx.remote.$mount(workspaceRemote);
  ctx.effect(() => releaseRemote);
  await ctx.inject(['remote.filensWorkspace'], applyWorkspace);
}

function applyWorkspace(ctx) {
  const lifetime = new AbortController();
  let scan, navigation;
  const noticeListeners = new Set();
  let notice = null;
  const notify = value => { notice = value; for (const listener of noticeListeners) listener(value); };
  function NavigationNotice() {
    const [value, setValue] = useState(notice);
    useEffect(() => { noticeListeners.add(setValue); return () => noticeListeners.delete(setValue); }, []);
    if (!value) return null;
    return h('div', { className: 'fw-notice', role: value.error ? 'alert' : 'status' }, value.text,
      h('button', { type: 'button', onClick: () => notify(null), 'aria-label': '关闭 / Close' }, '×'));
  }
  async function refresh() {
    scan?.abort();
    scan = new AbortController();
    const signal = AbortSignal.any([scan.signal, lifetime.signal]);
    try {
      await collectSessionFiles(ctx.remote, __FILENS_EXTENSIONS__, signal, state => setSessionFiles(state, entry => async readSignal => {
        const origin = entry.origins[0];
        const path = entry.attachment ? remoteValue(await ctx.remote.filensWorkspace.attachmentPath(origin.sessionId, entry.attachment, readSignal)) : entry.path;
        const result = remoteValue(await ctx.remote.workspaceFiles.readBytes(origin.sessionId, path, {}, readSignal));
        if (!result.eof || result.offset !== 0) throw new Error('DSH returned an incomplete file');
        return result.data;
      }));
    } catch (error) {
      if (!signal.aborted) setSessionFiles({ error: error.message });
    }
  }
  async function locate(source) {
    navigation?.abort();
    navigation = new AbortController();
    const signal = AbortSignal.any([navigation.signal, lifetime.signal]);
    const zh = document.documentElement.lang.startsWith('zh');
    notify({ text: zh ? '正在定位来源消息…' : 'Finding source message…' });
    let reference;
    try {
      reference = ctx.sessions.retain(source.sessionId, { source: 'filensWorkspace', signal });
      const binding = await reference.ready;
      await binding.session.loadThrough(source.seq);
      signal.throwIfAborted();
      const conversation = ctx.uiConversation.binding(binding);
      conversation.activate('chat');
      const view = ctx.slots.entriesOfSlot('conversation.session').find(entry => entry.store);
      if (view) ctx.slots.resolveStore(view.store, ctx.uiSession.bindingSource(reference).getSnapshot()).actions.setView('chat');
      ctx.uiWorkspace.openSession(source.sessionId);
      const key = source.nodeKey;
      const row = await new Promise((resolve, reject) => {
        const find = () => {
          const node = [...document.querySelectorAll('[data-chat-node-key]')].find(element => element.getAttribute('data-chat-node-key') === key && element.getClientRects().length);
          if (node) { cleanup(); resolve(node); }
        };
        const observer = new MutationObserver(find);
        const timer = setTimeout(() => { cleanup(); reject(new Error(zh ? '已打开会话，但来源消息未显示。请切换到对话视图后重试。' : 'Session opened, but the source message is unavailable. Switch to Chat and retry.')); }, 10000);
        const aborted = () => { cleanup(); reject(signal.reason); };
        const cleanup = () => { observer.disconnect(); clearTimeout(timer); signal.removeEventListener('abort', aborted); };
        observer.observe(document.body, { subtree: true, childList: true, attributes: true });
        signal.addEventListener('abort', aborted, { once: true });
        find();
      });
      signal.throwIfAborted();
      // DSH's stable node marker avoids matching repeated message text.
      row.scrollIntoView({ block: 'center', behavior: 'instant' });
      row.animate([{ outline: '2px solid #4c83d1', outlineOffset: '4px' }, { outline: '2px solid transparent', outlineOffset: '4px' }], { duration: 2200 });
      notify(null);
    } catch (error) {
      if (!signal.aborted) notify({ text: error.message, error: true });
    } finally { reference?.release(); }
  }
  ctx.effect(() => {
    const sheet = document.createElement('style');
    sheet.textContent = styles + viewerStyles + workspaceStyles;
    document.head.append(sheet);
    return () => { lifetime.abort(); sheet.remove(); clearWorkspace(); };
  });
  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panelId }, () => h(FilensWorkspace, { refresh, locate }))));
  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: panelId, order: 6,
    label: () => document.documentElement.lang.toLowerCase().startsWith('zh') ? '文件工作台' : 'File workspace',
  }, props => h(WorkspaceIcon, { ...props, name: 'grid' }))));
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'filens-source-location' }, NavigationNotice)));
}
