// Mount the shared frontend runtime directly into DSH's document body.
export function mountViewer(host, createPreview, source, callbacks) {
  let viewer, disposed = false, renderedFrame = 0;
  const controls = document.createElement('div');
  controls.className = 'filens-dsh-controls';
  const positionControls = () => {
    const rect = controls.getBoundingClientRect();
    controls.style.setProperty('--filens-controls-top', `${rect.bottom + 8}px`);
    controls.style.setProperty('--filens-controls-left', `${Math.max(12, Math.min(innerWidth - 316, rect.right - 304))}px`);
  };
  function localizeChrome() {
    const hint = host.querySelector('.model3dv-hint');
    const label = host.lang.toLowerCase().startsWith('zh')
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
    host.dataset.theme = value.dark ? 'dark' : 'light';
    host.style.colorScheme = controls.style.colorScheme = value.dark ? 'dark' : 'light';
    for (const key of ['panel', 'surface', 'text', 'muted', 'border', 'accent']) {
      const color = value.colors?.[key];
      if (typeof color === 'string' && CSS.supports('color', color)) {
        host.style.setProperty(`--filens-${key}`, color);
        controls.style.setProperty(`--filens-${key}`, color);
      }
    }
    if (typeof value.font === 'string') {
      host.style.setProperty('--filens-font', value.font);
      controls.style.setProperty('--filens-font', value.font);
    }
    if (typeof value.locale === 'string') {
      host.lang = value.locale;
      viewer?.update({ locale: value.locale });
    }
    localizeChrome();
  }

  // Password entry must stay interactive while document rendering is pending.
  let interactiveRequest = false;
  const observer = new MutationObserver(() => {
    scheduleChrome();
    if (!interactiveRequest && host.querySelector('.pptxv-password-form')) {
      interactiveRequest = true;
      callbacks.onInteractive();
    }
  });
  observer.observe(host, { childList: true, subtree: true });
  const resize = new ResizeObserver(scheduleChrome);
  resize.observe(host);
  const controlsResize = new ResizeObserver(positionControls);
  controlsResize.observe(controls);
  window.addEventListener('resize', positionControls);
  window.addEventListener('scroll', positionControls, true);


  applyAppearance(source.appearance);
  viewer = createPreview(host, {
    src: source.bytes, name: source.name, locale: host.lang, toolbar: true, controlsTarget: controls,
    onStateChange: state => {
      const capabilities = state.capabilities ?? {};
      host.dataset.family = state.family;
      host.dataset.page = String(state.pageIndex ?? state.activeSheetIndex ?? state.chapterIndex ?? 0);
      host.dataset.zoom = String(Boolean(capabilities.zoom));
      host.dataset.fullscreen = String(Boolean(capabilities.fullscreen));
      callbacks.onStateChange(state);
    },
    onRendered: () => {
      cancelAnimationFrame(renderedFrame);
      // PDF has already awaited a painted canvas; it needs no DOCX fit pass.
      // Remove the loading cover in the same frame instead of holding it over
      // a complete first page for one extra animation frame.
      if (host.querySelector('.pdfv-page[data-rendered="true"]')) {
        if (!disposed) callbacks.onRendered();
        return;
      }
      renderedFrame = requestAnimationFrame(() => {
        if (!disposed) { fitDocument(); callbacks.onRendered(); }
      });
    },
    onError: callbacks.onError,
  });
  return {
    controls,
    getState: () => viewer.getState(),
    setScale: scale => viewer.setScale(scale),
    fullscreen: () => viewer.fullscreen(),
    updateAppearance: applyAppearance,
    destroy() {
      disposed = true; cancelAnimationFrame(renderedFrame);
      cancelAnimationFrame(chromeFrame);
      observer.disconnect(); resize.disconnect(); controlsResize.disconnect();
      window.removeEventListener('resize', positionControls);
      window.removeEventListener('scroll', positionControls, true);
      viewer.destroy(); controls.remove();
    },
  };
}
