import { loadSourceBytes } from '../parser/load-source';
import { readOfficeAttachments } from '../parser/attachments';
import { createPreviewContainerContext, descendPreviewContainer, waitForContainerTask } from './containers';
import { previewPasswordErrorCode } from './password';
import { isArchiveVolumeName, selectArchiveVolumes } from '../parser/archive-volumes';
import type { PreviewAttachment, PreviewEventMap, PreviewEventName, PreviewItemState, PreviewLoadContext, PreviewOptions, PreviewSession, PreviewSource, PreviewerInstance, SourceDescriptor } from './types';

/** Keep the document mounted while a child is open, preserving renderer state,
 * scroll position and virtual pages. Errors in a child stay inside its panel. */
export function createAttachmentPreviewSession(
  host: HTMLElement, options: PreviewOptions, format: string,
  createSession: (documentHost: HTMLElement) => PreviewSession
): PreviewSession {
  const doc = host.ownerDocument;
  const root = doc.createElement('div');
  root.className = 'filens-attachments-shell';
  const documentHost = doc.createElement('div');
  documentHost.className = 'filens-attachments-document';
  root.append(documentHost);
  host.replaceChildren(root);
  const inner = createSession(documentHost);
  const context = options.containerContext ?? createPreviewContainerContext();
  const t = options.translate ?? ((message: string) => message);
  const listeners = new Map<PreviewEventName, Set<(value: never) => void>>();
  const unsubscribes: Array<() => void> = [];
  const urls = new Set<string>();
  let controller: AbortController | undefined;
  let operation: AbortController | undefined;
  let child: PreviewerInstance | undefined;
  let childPanel: HTMLDivElement | undefined;
  let toolbar: HTMLDetailsElement | undefined;
  let childUnsubscribes: Array<() => void> = [];
  let parentName: string | undefined;
  let returnFocus: HTMLElement | undefined;
  let metadataWarnings: string[] = [];
  let availableAttachments: PreviewAttachment[] = [];

  const state = (): PreviewItemState => child
    ? { ...child.getState(), loading: false, error: null }
    : { ...inner.getState(), warnings: [...inner.getState().warnings, ...metadataWarnings] };
  const emit = <K extends PreviewEventName>(event: K, value: PreviewEventMap[K]) => {
    for (const callback of listeners.get(event) ?? []) callback(value as never);
  };
  for (const event of ['loading', 'rendered', 'statechange', 'error', 'warnings'] as const) {
    unsubscribes.push(inner.on(event, value => { if (!operation) emit(event, value); }));
  }
  const back = () => {
    operation?.abort();
    operation = undefined;
    childUnsubscribes.splice(0).forEach(unsubscribe => unsubscribe());
    child?.destroy();
    child = undefined;
    childPanel?.remove();
    childPanel = undefined;
    documentHost.hidden = false;
    if (toolbar) toolbar.hidden = false;
    const focus = returnFocus;
    returnFocus = undefined;
    if (focus?.isConnected) focus.focus({ preventScroll: true });
    emit('statechange', state());
  };
  const button = (text: string, action: () => void): HTMLButtonElement => {
    const element = doc.createElement('button');
    element.type = 'button';
    element.textContent = text;
    element.addEventListener('click', action);
    return element;
  };
  const download = async (descriptor: SourceDescriptor, signal?: AbortSignal) => {
    const bytes = await loadSourceBytes(descriptor.source, { signal });
    signal?.throwIfAborted();
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: descriptor.contentType ?? 'application/octet-stream' }));
    urls.add(url);
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = descriptor.name ?? 'attachment.bin';
    anchor.click();
    // Allow the browser to consume the URL before releasing it.
    setTimeout(() => { if (urls.delete(url)) URL.revokeObjectURL(url); }, 1000);
  };
  const open = async (attachment: PreviewAttachment, downloadOnly = false) => {
    if (!controller || controller.signal.aborted) return;
    const focus = returnFocus ?? (doc.activeElement instanceof HTMLElement ? doc.activeElement : undefined);
    back();
    returnFocus = focus;
    const current = new AbortController();
    operation = current;
    const abort = () => current.abort();
    const parentSignal = controller.signal;
    parentSignal.addEventListener('abort', abort, { once: true });
    current.signal.addEventListener('abort', () => parentSignal.removeEventListener('abort', abort), { once: true });
    const isCurrent = () => operation === current && !current.signal.aborted;
    documentHost.hidden = true;
    if (toolbar) toolbar.hidden = true;
    childPanel = doc.createElement('div');
    childPanel.className = 'filens-attachment-panel';
    const navigation = doc.createElement('div');
    navigation.className = 'filens-attachment-navigation';
    navigation.dataset.previewControls = '';
    const backButton = button(t('Back to document'), back);
    const label = doc.createElement('span');
    label.textContent = `${parentName ?? t('Document')} › ${attachment.name}`;
    navigation.append(backButton, label);
    const status = doc.createElement('p');
    status.className = 'filens-attachment-status';
    status.setAttribute('role', 'status');
    status.textContent = t('Loading preview...');
    const childHost = doc.createElement('div');
    childHost.className = 'filens-attachment-preview';
    childPanel.append(navigation, status, childHost);
    root.append(childPanel);
    const showError = (error: Error) => {
      if (!isCurrent()) return;
      if (previewPasswordErrorCode(error) === 'password_cancelled') { back(); return; }
      status.hidden = false;
      status.textContent = error.message;
      status.setAttribute('role', 'alert');
      // Failed children remain retryable without reopening the parent document.
    };
    let descriptor: SourceDescriptor | undefined;
    const readDownload = async (): Promise<SourceDescriptor> => {
      if (descriptor) return descriptor;
      try { return await waitForContainerTask(attachment.read(current.signal), current.signal); }
      catch (error) {
        current.signal.throwIfAborted();
        if (previewPasswordErrorCode(error) || !attachment.readRaw) throw error;
        return waitForContainerTask(attachment.readRaw(current.signal), current.signal);
      }
    };
    navigation.append(button(t('Download attachment'), () => {
      void readDownload().then(value => download(value, current.signal)).catch(showError);
    }));
    navigation.append(button(t('Retry'), () => { void open(attachment); }));
    backButton.focus({ preventScroll: true });
    try {
      const childContext = downloadOnly ? context : descendPreviewContainer(context);
      descriptor = downloadOnly ? await readDownload() : await waitForContainerTask(attachment.read(current.signal), current.signal);
      if (!isCurrent()) return;
      if (!downloadOnly && descriptor.name && (isArchiveVolumeName(descriptor.name) ||
          (/\.(rar|zip)$/i.test(descriptor.name) && availableAttachments.some(part => part !== attachment &&
            (isArchiveVolumeName(part.name) || /\.bin$/i.test(part.name)))))) {
        const named = [{ ...descriptor, name: descriptor.name }];
        for (const sibling of availableAttachments) {
          if (sibling === attachment || (!isArchiveVolumeName(sibling.name) && !/\.(rar|zip|bin)$/i.test(sibling.name))) continue;
          try {
            const value = await waitForContainerTask(sibling.read(current.signal), current.signal);
            if (value.name) named.push({ ...value, name: value.name });
          } catch (error) {
            current.signal.throwIfAborted();
            if (previewPasswordErrorCode(error) || (error instanceof Error && /limit/.test(error.message))) throw error;
            // Unrelated damaged OLE wrappers are not part of this volume set.
          }
        }
        const set = selectArchiveVolumes(descriptor.name, named);
        if (set) descriptor = { ...set.primary, archiveVolumes: set.files.slice(1).map(part => ({ name: part.name, source: part.source })) };
      }
      label.textContent = `${parentName ?? t('Document')} › ${descriptor.name ?? attachment.name}`;
      if (downloadOnly) {
        await download(descriptor, current.signal);
        if (isCurrent()) back();
        return;
      }
      if (!options.previewerFactory) throw new Error(t('No previewer is configured for this attachment.'));
      child = options.previewerFactory(childHost, { ...options, containerContext: childContext });
      childUnsubscribes = [
        child.on('error', showError),
        child.on('statechange', () => {
          if (!isCurrent()) return;
          emit('statechange', state());
        }),
        child.on('warnings', warnings => { if (isCurrent()) emit('warnings', warnings); }),
        child.on('rendered', () => { if (isCurrent()) emit('rendered', state()); })
      ];
      await waitForContainerTask(child.preview(descriptor), current.signal);
      if (!isCurrent()) return;
      if (child.getState().error) showError(new Error(child.getState().error!));
      else status.hidden = true;
      emit('statechange', state());
    } catch (error) {
      showError(error instanceof Error ? error : new Error(String(error)));
      if (isCurrent()) emit('statechange', state());
    }
  };

  const overrides: Partial<PreviewSession> = {
    async load(source: PreviewSource, loadContext: PreviewLoadContext) {
      controller?.abort();
      back();
      toolbar?.remove();
      toolbar = undefined;
      metadataWarnings = [];
      availableAttachments = [];
      const loadController = new AbortController();
      controller = loadController;
      const signal = loadController.signal;
      const parentSignal = loadContext.signal;
      const abort = () => loadController.abort();
      parentSignal?.addEventListener('abort', abort, { once: true });
      signal.addEventListener('abort', () => parentSignal?.removeEventListener('abort', abort), { once: true });
      if (parentSignal?.aborted) controller.abort();
      parentName = loadContext.descriptor.name;
      await inner.load(source, { ...loadContext, signal });
      signal.throwIfAborted();
      try {
        const attachments = availableAttachments = await waitForContainerTask(inner.getAttachments ? inner.getAttachments()
          : ['docx', 'xlsx', 'pptx'].includes(format)
            ? readOfficeAttachments(await loadSourceBytes(source, { signal }), context, signal) : Promise.resolve([]), signal);
        signal.throwIfAborted();
        if (!attachments.length) return;
        toolbar = doc.createElement('details');
        toolbar.className = 'filens-attachments';
        toolbar.dataset.previewControls = '';
        const summary = doc.createElement('summary');
        summary.textContent = `${t('Attachments')} (${attachments.length})`;
        toolbar.append(summary);
        const list = doc.createElement('ul');
        for (const attachment of attachments) {
          const row = doc.createElement('li');
          row.append(button(attachment.name, () => { void open(attachment); }),
            button(t('Download attachment'), () => { void open(attachment, true); }));
          list.append(row);
        }
        toolbar.append(list);
        root.prepend(toolbar);
      } catch (error) {
        if (signal.aborted) throw error;
        // A damaged embedded object must not prevent reading the document.
        metadataWarnings = [t('Some document attachments could not be read.')];
        emit('warnings', state().warnings);
        emit('statechange', state());
      }
    },
    getState: state,
    on(event, callback) {
      let callbacks = listeners.get(event);
      if (!callbacks) listeners.set(event, callbacks = new Set());
      callbacks.add(callback as (value: never) => void);
      return () => callbacks.delete(callback as (value: never) => void);
    },
    destroy() {
      controller?.abort();
      back();
      unsubscribes.splice(0).forEach(unsubscribe => unsubscribe());
      listeners.clear();
      inner.destroy();
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
      root.remove();
    }
  };
  return new Proxy(inner, {
    get(target, property) {
      if (property in overrides) return Reflect.get(overrides, property);
      const receiver = child && property in child ? child : target;
      const value = Reflect.get(receiver, property);
      return typeof value === 'function' ? value.bind(receiver) : value;
    }
  });
}
