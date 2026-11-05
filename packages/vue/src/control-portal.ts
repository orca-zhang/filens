/** Move driver-owned controls without cloning nodes or replacing their handlers.
 * Anchors preserve ownership: a driver's rerender/destroy removes its anchor,
 * which retires the corresponding external controls on the same microtask.
 * Vue-owned controls use Teleport instead.
 */
export function createControlPortal(source: HTMLElement, target: HTMLElement) {
  const entries = new Map<HTMLElement, { anchor: Comment; frame: HTMLElement }>();
  function sync() {
    for (const [element, { anchor, frame }] of entries) {
      if (!source.contains(anchor) || !frame.contains(element)) {
        element.remove(); anchor.remove(); frame.remove(); entries.delete(element);
      }
    }
    for (const element of source.querySelectorAll<HTMLElement>('[data-preview-controls]')) {
      if (element.parentElement?.closest('[data-preview-controls]')) continue;
      const anchor = source.ownerDocument.createComment('preview controls');
      const frame = source.ownerDocument.createElement('span');
      element.before(anchor);
      entries.set(element, { anchor, frame });
      frame.append(element); target.append(frame);
    }
    for (const { anchor, frame } of entries.values()) {
      // Attachment previews retain the parent document behind a hidden host.
      // Its external controls must follow that visibility without changing the
      // driver's own hidden state (for example unavailable lyric timing).
      frame.hidden = Boolean(anchor.parentElement?.closest('[hidden]'));
      frame.style.display = frame.hidden ? 'none' : 'contents';
    }
  }
  const observer = new MutationObserver(sync);
  observer.observe(source, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
  sync();
  return () => {
    observer.disconnect();
    for (const [element, { anchor, frame }] of entries) {
      if (source.contains(anchor)) anchor.replaceWith(element);
      else element.remove();
      frame.remove();
    }
    entries.clear();
  };
}
