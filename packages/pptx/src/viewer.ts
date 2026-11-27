import type {
  FitMode,
  ParsedPresentation,
  SlideCommentAnchor,
  ViewerEventMap,
  ViewerEventName,
  ViewerInstance,
  ViewerOptions,
  ViewerState
} from '@filens/core/presentation-support';
import {
  bindPreviewTouchGestures, clamp, collectSlideFontReferences, fontFamilyKey, MediaRegistry, observeHostFontLoads, throwIfAborted
} from '@filens/core/presentation-support';
import { preparePptxEmbeddedFonts } from './embedded-fonts';
import { commentAnchors, slidesWithCommentSources } from './comment-references';
import type { PptxArchiveOptions } from './parser/archive';
import { readPptxPresentation } from './parser/load-pptx';
import { renderCommentLocation, resolveCommentLocation, type CommentLocation } from './render/comment-location';
import { renderSlideToElement, translateOleItem, type RenderSlideOptions } from './render/dom';
import { renderSlideComments } from './render/slide-comments';
import { playableSlideTransition, playSlideTransition } from './render/slide-transition';
import { SlideAnimationPlayer } from './render/slide-animations';

type ListenerMap = {
  [K in ViewerEventName]: Set<(payload: ViewerEventMap[K]) => void>;
};

interface SlidePanel {
  details: HTMLDetailsElement;
  summary: HTMLElement;
  body: HTMLDivElement;
  label: string;
}

export class PptxViewer implements ViewerInstance {
  private readonly options: Required<ViewerOptions>;
  private readonly root: HTMLDivElement;
  private readonly scrollArea: HTMLDivElement;
  private readonly speakerNotes: SlidePanel;
  private readonly comments: SlidePanel;
  private readonly animation: SlideAnimationPlayer;
  private unbindTouch = () => {};
  private readonly unbindHostFonts: () => void;
  private readonly listeners: ListenerMap = {
    rendered: new Set(),
    error: new Set(),
    slidechange: new Set(),
    scalechange: new Set(),
    warnings: new Set()
  };

  private resizeObserver?: ResizeObserver;
  private shells: HTMLDivElement[] = [];
  private mountedSlides = new Set<number>();
  private mountedStages = new Map<number, HTMLDivElement>();
  private slideRoots = new Map<number, HTMLElement>();
  private requestToken = 0;
  private fallbackScrollRaf = 0;
  private activeAbortController: AbortController | null = null;
  private mediaRegistry: MediaRegistry | null = null;
  private presentation: ParsedPresentation | null = null;
  private lastViewedSlide: number | null = null;
  private navigationSourceSlide: number | null = null;
  private navigationTargetSlide: number | null = null;
  private navigationSettleTimer = 0;
  private stopSlideTransition?: () => void;
  private pendingFontRefresh = false;
  private locatedComment?: { anchor: SlideCommentAnchor; location: CommentLocation };
  private commentHighlight?: HTMLElement;
  private commentSource?: {
    refresh: () => void;
    close: () => void;
  };
  private openAttachment?: RenderSlideOptions['openAttachment'];

  private state: ViewerState = {
    loading: false,
    error: null,
    currentSlide: 0,
    slideCount: 0,
    scale: 1,
    fit: 'contain',
    warnings: [],
    presentation: null,
    mediaRegistry: null
  };

  constructor(private readonly container: HTMLElement, options: ViewerOptions = {}, observeHostFonts = true) {
    this.options = {
      width: options.width ?? 0,
      height: options.height ?? 0,
      fit: options.fit ?? 'contain',
      initialScale: options.initialScale ?? 1,
      minScale: options.minScale ?? 0.4,
      maxScale: options.maxScale ?? 4,
      virtual: options.virtual ?? true,
      translate: options.translate ?? (message => message)
    };
    this.state.fit = this.options.fit;
    this.state.scale = clamp(this.options.initialScale, this.options.minScale, this.options.maxScale);

    this.root = document.createElement('div');
    this.root.className = 'pptxv-viewer';
    if (this.options.width) {
      this.root.style.width = `${this.options.width}px`;
    }
    if (this.options.height) {
      this.root.style.height = `${this.options.height}px`;
    }

    this.scrollArea = document.createElement('div');
    this.scrollArea.className = 'pptxv-scroll-area';
    this.speakerNotes = this.createSlidePanel('pptxv-speaker-notes', 'Speaker notes');
    this.comments = this.createSlidePanel('pptxv-slide-comments', 'Comments');
    this.animation = new SlideAnimationPlayer(this.root.ownerDocument, () => this.slideRoots.get(this.state.currentSlide),
      this.options.translate, () => this.clearSlideTransition(), () => this.flushFontRefresh());
    this.root.append(this.scrollArea, this.animation.controls, this.speakerNotes.details, this.comments.details);
    this.root.addEventListener('click', this.handleLinkClick);
    this.refreshTranslations();

    this.container.innerHTML = '';
    this.container.appendChild(this.root);

    this.bindResizeObserver();
    this.unbindHostFonts = observeHostFonts ? observeHostFontLoads(container.ownerDocument.fonts, families => {
      if (!this.presentation) return;
      const loaded = new Set(families);
      if (collectSlideFontReferences(slidesWithCommentSources(this.presentation)).some(ref => loaded.has(fontFamilyKey(ref.fontFamily)))) this.refreshFonts();
    }) : () => {};
  }

  async preview(source: Parameters<ViewerInstance['preview']>[0], signal?: AbortSignal,
    zipEntries?: PptxArchiveOptions['zipEntries'], openAttachment?: RenderSlideOptions['openAttachment']): Promise<void> {
    this.unbindTouch();
    const token = ++this.requestToken;
    this.activeAbortController?.abort();
    const controller = this.activeAbortController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (signal && controller) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', () => controller.abort(), { once: true, signal: controller.signal });
    }
    this.beginLoadingState();
    this.openAttachment = openAttachment;
    this.renderLoadingState();

    try {
      const { presentation, embeddedFonts } = await readPptxPresentation(source, {
        signal: controller?.signal,
        zipEntries
      });
      if (token !== this.requestToken) return;
      throwIfAborted(controller?.signal);
      const loadFonts = preparePptxEmbeddedFonts(presentation, embeddedFonts, this.container.ownerDocument, controller?.signal);
      this.applyPresentation(presentation);
      if (loadFonts) void loadFonts().then(loaded => {
        if (token !== this.requestToken || controller?.signal.aborted) return;
        if (loaded) this.refreshFonts();
        else this.emit('rendered', this.getState());
      });
    } catch (error) {
      if (token !== this.requestToken) {
        return;
      }
      if (isAbortError(error)) {
        this.state.loading = false;
        this.clearRenderedSlides();
        return;
      }
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      this.state.loading = false;
      this.state.error = normalizedError.message;
      this.renderErrorState(normalizedError.message);
      this.emit('error', normalizedError);
    }
  }

  destroy(): void {
    this.unbindTouch();
    this.unbindHostFonts();
    this.requestToken += 1;
    this.activeAbortController?.abort();
    this.activeAbortController = null;
    this.resizeObserver?.disconnect();
    this.mediaRegistry?.destroy();
    this.root.removeEventListener('click', this.handleLinkClick);
    for (const panel of [this.speakerNotes, this.comments]) {
      panel.details.removeEventListener('toggle', this.handleSlidePanelToggle);
      panel.details.removeEventListener('keydown', this.handleSlidePanelKeydown);
    }
    this.resetSlidePanels();
    this.clearRenderedSlides();
    this.container.innerHTML = '';
    this.presentation = null;
    this.openAttachment = undefined;
    this.mediaRegistry = null;
    this.state.presentation = null;
    this.state.mediaRegistry = null;
    this.state.loading = false;
    this.state.error = null;
    this.state.slideCount = 0;
    this.state.currentSlide = 0;
    this.state.warnings = [];
    this.lastViewedSlide = null;
    this.navigationSourceSlide = null;
    this.clearNavigationSettleTimer();
  }

  setScale(scale: number): void {
    const nextScale = clamp(scale, this.options.minScale, this.options.maxScale);
    const shouldEmit = this.state.fit !== 'none' || nextScale !== this.state.scale;
    if (nextScale !== this.state.scale) this.clearSlideTransition();
    this.state.fit = 'none';
    this.state.scale = nextScale;
    if (!shouldEmit) {
      return;
    }
    this.layoutSlides();
    this.emit('scalechange', this.getState());
  }

  fit(mode?: FitMode): void {
    const nextFit = mode ?? this.state.fit;
    const fitChanged = nextFit !== this.state.fit;
    this.state.fit = nextFit;
    this.applyFitScale();
    if (!fitChanged && !this.presentation) {
      return;
    }
    this.layoutSlides();
    this.emit('scalechange', this.getState());
  }

  goToSlide(index: number): void {
    const normalized = clamp(index, 0, Math.max(this.shells.length - 1, 0));
    const shell = this.shells[normalized];
    if (!shell) {
      return;
    }

    const presentation = this.presentation;
    const previous = this.state.currentSlide;
    const transition = normalized !== previous ? playableSlideTransition(presentation?.slides[normalized]?.transition) : undefined;
    const preferred = getPreferredScrollBehavior();
    const behavior = transition ? 'instant' : preferred;
    this.beginProgrammaticNavigation(behavior);
    this.navigationTargetSlide = normalized;
    shell.scrollIntoView({
      behavior,
      block: 'start'
    });
    this.setCurrentSlide(normalized);
    if (!transition || preferred === 'instant' || !presentation || this.presentation !== presentation
      || this.state.currentSlide !== normalized || !this.mediaRegistry || (transition.effect === 'cut' && !transition.throughBlack)
      || transition.durationMs === 0) return;

    const stage = this.mountedStages.get(normalized);
    const incoming = this.slideRoots.get(normalized);
    if (!stage || !incoming || typeof incoming.animate !== 'function') return;
    const outgoing = renderSlideToElement(presentation.slides[previous], presentation, {
      mediaRegistry: this.mediaRegistry, thumbnail: true, translate: this.options.translate
    });
    outgoing.style.transform = incoming.style.transform;
    outgoing.style.transformOrigin = 'top left';
    this.stopSlideTransition = playSlideTransition(stage, incoming, outgoing, transition, this.releaseSlideTransition);
  }

  next(): void {
    this.goToSlide(this.state.currentSlide + 1);
  }

  prev(): void {
    this.goToSlide(this.state.currentSlide - 1);
  }

  getState(): ViewerState {
    return {
      ...this.state,
      presentation: this.presentation,
      mediaRegistry: this.mediaRegistry
    };
  }

  refreshTranslations(): void {
    this.animation.syncControls();
    for (const panel of [this.speakerNotes, this.comments]) {
      const label = this.options.translate(panel.label);
      panel.summary.textContent = label;
      panel.body.setAttribute('aria-label', label);
    }
    this.syncSlidePanels();
    this.commentSource?.refresh();
    for (const item of this.root.querySelectorAll<HTMLElement>('.pptxv-item--ole')) translateOleItem(item, this.options.translate);
  }

  on<T extends ViewerEventName>(event: T, handler: (payload: ViewerEventMap[T]) => void): () => void {
    this.listeners[event].add(handler as never);
    return () => {
      this.listeners[event].delete(handler as never);
    };
  }

  private emit<T extends ViewerEventName>(event: T, payload: ViewerEventMap[T]): void {
    for (const handler of this.listeners[event]) {
      handler(payload as never);
    }
  }

  private applyPresentation(presentation: ParsedPresentation): void {
    this.mediaRegistry?.destroy();
    this.presentation = presentation;
    this.lastViewedSlide = null;
    this.mediaRegistry = new MediaRegistry(presentation);
    this.state.loading = false;
    this.state.error = null;
    this.state.presentation = presentation;
    this.state.mediaRegistry = this.mediaRegistry;
    this.state.slideCount = presentation.slides.length;
    this.state.currentSlide = 0;
    this.state.warnings = presentation.warnings;
    const hasNotes = presentation.slides.some(slide => slide.speakerNotes);
    const hasComments = presentation.slides.some(slide => slide.comments?.length);
    const hasAnimations = presentation.slides.some(slide => slide.animations?.length);
    this.speakerNotes.details.hidden = !hasNotes;
    this.comments.details.hidden = !hasComments;
    this.root.classList.toggle('pptxv-viewer--slide-panels', hasNotes || hasComments || hasAnimations);
    this.animation.select(presentation.slides[0]?.animations);

    // Measuring the viewport should not lay out stale slides/loading text.
    this.clearRenderedSlides();
    if (this.state.fit !== 'none') {
      this.applyFitScale();
    } else {
      this.state.scale = clamp(this.state.scale, this.options.minScale, this.options.maxScale);
    }

    this.scrollArea.scrollTop = 0;
    this.renderSlideShells();
    this.unbindTouch = bindPreviewTouchGestures(this.scrollArea, {
      getScale: () => this.state.scale,
      setScale: scale => this.setScale(scale),
      enabled: () => !this.state.loading && !!this.presentation,
      minScale: this.options.minScale,
      maxScale: this.options.maxScale
    });
    this.emit('warnings', presentation.warnings);
    this.emit('rendered', this.getState());
  }

  private renderLoadingState(): void {
    this.clearRenderedSlides();
    const loading = document.createElement('div');
    loading.className = 'pptxv-loading';
    loading.textContent = 'Loading presentation...';
    this.scrollArea.appendChild(loading);
  }

  private renderErrorState(message: string): void {
    this.clearRenderedSlides();
    const error = document.createElement('div');
    error.className = 'pptxv-loading pptxv-loading--error';
    error.textContent = `Unable to load presentation: ${message}`;
    this.scrollArea.appendChild(error);
  }

  private createSlidePanel(className: string, label: string): SlidePanel {
    const doc = this.container.ownerDocument;
    const details = doc.createElement('details');
    details.className = `pptxv-slide-panel ${className}`;
    details.hidden = true;
    const summary = doc.createElement('summary');
    const body = doc.createElement('div');
    body.className = `pptxv-slide-panel-body ${className}-text`;
    body.tabIndex = 0;
    body.dir = 'auto';
    body.setAttribute('role', 'region');
    details.append(summary, body);
    details.addEventListener('toggle', this.handleSlidePanelToggle);
    details.addEventListener('keydown', this.handleSlidePanelKeydown);
    return { details, summary, body, label };
  }

  private syncSlidePanels(): void {
    const { presentation } = this;
    const index = this.state.currentSlide;
    const slide = presentation?.slides[index];
    const text = !this.speakerNotes.details.open || !slide ? ''
      : slide.speakerNotes ?? this.options.translate('No speaker notes on this slide.');
    if (this.speakerNotes.body.textContent !== text) {
      this.speakerNotes.body.textContent = text;
      this.speakerNotes.body.scrollTop = 0;
    }

    const body = this.comments.body;
    if (!this.comments.details.open || !slide || !presentation) {
      this.clearCommentLocation();
      body.replaceChildren();
    } else if (slide.comments?.length) {
      const scrollTop = body.scrollTop;
      body.replaceChildren(renderSlideComments(body.ownerDocument, slide.comments, this.options.translate, comment =>
        commentAnchors(comment).flatMap(anchor => {
          const location = resolveCommentLocation(presentation, index, anchor);
          if (!location) return [];
          const label = location.source
            ? anchor.layout ? 'Locate on slide layout' : 'Locate on slide master'
            : 'Locate on slide';
          return [{
            label, opensDialog: !!location.source, selected: this.locatedComment?.anchor === anchor,
            activate: button => {
              if (location.source) this.openCommentSource(location.source, location, label, button);
              else this.locateComment(anchor, location, button);
            }
          }];
        })
      ));
      body.scrollTop = scrollTop;
    } else {
      body.textContent = this.options.translate('No comments on this slide.');
    }
  }

  private resetSlidePanels(): void {
    this.clearCommentLocation();
    this.animation.select();
    for (const { details, body } of [this.speakerNotes, this.comments]) {
      details.open = false;
      details.hidden = true;
      body.replaceChildren();
    }
    this.root.classList.remove('pptxv-viewer--slide-panels');
  }

  private readonly handleSlidePanelKeydown = (event: KeyboardEvent) => {
    const panel = event.currentTarget === this.speakerNotes.details ? this.speakerNotes : this.comments;
    if (event.key !== 'Escape' || !panel.details.open) return;
    event.preventDefault();
    event.stopPropagation();
    panel.details.open = false;
    panel.summary.focus();
  };

  private readonly handleSlidePanelToggle = (event: Event) => {
    const panel = event.currentTarget as HTMLDetailsElement;
    if (event.target !== panel || !this.presentation || panel.hidden) return;
    if (panel.open) {
      const other = panel === this.speakerNotes.details ? this.comments.details : this.speakerNotes.details;
      other.open = false;
    }
    this.syncSlidePanels();
    const anchor = this.shells[this.state.currentSlide];
    const top = anchor?.getBoundingClientRect().top;
    const previousScale = this.state.scale;
    if (this.state.fit !== 'none') this.applyFitScale();
    if (this.state.scale !== previousScale) {
      this.layoutSlides();
      if (anchor && top !== undefined) {
        const scrollTop = this.scrollArea.scrollTop + anchor.getBoundingClientRect().top - top;
        if (this.scrollArea.scrollTo) this.scrollArea.scrollTo({ top: scrollTop, behavior: 'instant' });
        else this.scrollArea.scrollTop = scrollTop;
      }
      this.emit('scalechange', this.getState());
    } else {
      this.syncMountedSlides();
    }
  };

  private renderSlideShells(): void {
    this.clearRenderedSlides();

    if (!this.presentation) {
      return;
    }

    if (this.presentation.slides.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'pptxv-loading pptxv-loading--empty';
      empty.textContent = 'No slides in presentation.';
      this.scrollArea.appendChild(empty);
      return;
    }

    this.presentation.slides.forEach((slide, index) => {
      const shell = document.createElement('div');
      shell.className = 'pptxv-slide-shell';
      shell.dataset.slideIndex = String(index);

      this.scrollArea.appendChild(shell);
      this.shells.push(shell);
    });

    this.layoutSlides();
    this.bindSlideTracking();
  }

  private layoutSlides(): void {
    if (!this.presentation) {
      return;
    }

    this.presentation.slides.forEach((slide, index) => {
      const shell = this.shells[index];
      if (!shell) {
        return;
      }

      shell.style.width = `${slide.width * this.state.scale}px`;
      shell.style.minHeight = `${slide.height * this.state.scale}px`;
      shell.style.height = `${slide.height * this.state.scale}px`;
    });

    this.syncMountedSlides();
    this.paintCommentLocation();
    this.handleFallbackScroll();
  }

  private syncMountedSlides(): void {
    if (!this.presentation || !this.mediaRegistry) {
      return;
    }

    const allowed = new Set<number>();
    if (!this.options.virtual) {
      for (let index = 0; index < this.presentation.slides.length; index += 1) {
        allowed.add(index);
      }
    } else {
      allowed.add(this.state.currentSlide);
      if (this.navigationTargetSlide != null) allowed.add(this.navigationTargetSlide);
      const viewport = this.getTrackingViewport();
      if (viewport) {
        let anchor = this.state.currentSlide;
        const currentRect = this.shells[anchor]?.getBoundingClientRect();
        if (currentRect && (currentRect.bottom <= viewport.top || currentRect.top >= viewport.bottom)) {
          anchor = this.findTrackedSlideIndex() ?? anchor;
          allowed.add(anchor);
        }
        // Render every visible neighbor, including short slides at low zoom,
        // without making offscreen fonts/images part of the first preview.
        for (const direction of [-1, 1]) {
          for (let index = anchor + direction; index >= 0 && index < this.shells.length; index += direction) {
            const rect = this.shells[index].getBoundingClientRect();
            if (rect.height <= 0 || rect.bottom <= viewport.top || rect.top >= viewport.bottom) break;
            allowed.add(index);
          }
        }
      }
    }

    for (const mounted of [...this.mountedSlides]) {
      if (!allowed.has(mounted)) {
        this.unmountSlide(mounted);
      }
    }

    for (const index of allowed) {
      if (this.mountedSlides.has(index)) {
        this.updateMountedSlide(index);
        continue;
      }

      this.mountSlide(index);
    }
  }

  refreshFonts(): void {
    if (!this.presentation || this.state.loading) return;
    if (this.stopSlideTransition || this.animation.playing) {
      // Font relayout remounts slides. Keep the animated elements until playback settles.
      this.pendingFontRefresh = true;
      return;
    }
    const top = this.scrollArea.scrollTop, left = this.scrollArea.scrollLeft;
    const mounted = [...this.mountedSlides];
    for (const index of mounted) this.unmountSlide(index);
    for (const index of mounted) this.mountSlide(index);
    this.scrollArea.scrollTop = top; this.scrollArea.scrollLeft = left;
    this.animation.paint();
    this.paintCommentLocation();
    this.commentSource?.refresh();
    this.emit('rendered', this.getState());
  }

  private mountSlide(index: number): void {
    if (!this.presentation || !this.mediaRegistry) {
      return;
    }

    const shell = this.shells[index];
    if (!shell) {
      return;
    }

    const stage = document.createElement('div');
    stage.className = 'pptxv-slide-stage';

    const slideElement = renderSlideToElement(this.presentation.slides[index], this.presentation, {
      mediaRegistry: this.mediaRegistry,
      translate: this.options.translate,
      openAttachment: this.openAttachment
    });

    stage.appendChild(slideElement);
    shell.appendChild(stage);
    this.mountedStages.set(index, stage);
    this.slideRoots.set(index, slideElement);
    this.mountedSlides.add(index);
    this.updateMountedSlide(index);
  }

  private updateMountedSlide(index: number): void {
    if (!this.presentation) {
      return;
    }

    const stage = this.mountedStages.get(index);
    const slideElement = this.slideRoots.get(index);
    const slide = this.presentation.slides[index];
    if (!stage || !slideElement || !slide) {
      return;
    }

    stage.style.width = `${slide.width * this.state.scale}px`;
    stage.style.height = `${slide.height * this.state.scale}px`;
    slideElement.style.transform = `scale(${this.state.scale})`;
    slideElement.style.transformOrigin = 'top left';
  }

  private unmountSlide(index: number): void {
    this.mountedStages.get(index)?.remove();
    this.mountedStages.delete(index);
    this.slideRoots.delete(index);
    this.mountedSlides.delete(index);
  }

  private openCommentSource(
    slide: NonNullable<CommentLocation['source']>, location: CommentLocation, label: string, trigger: HTMLButtonElement
  ): void {
    const presentation = this.presentation;
    if (!presentation || !this.mediaRegistry || this.commentSource) return;
    const registry = this.mediaRegistry;
    const doc = this.root.ownerDocument;
    const dialog = doc.createElement('dialog');
    dialog.className = 'pptxv-comment-source';
    if (typeof dialog.showModal !== 'function') return;
    const back = doc.createElement('button');
    back.className = 'pptxv-comment-locate';
    back.type = 'button';
    back.autofocus = true;
    const stage = doc.createElement('div');
    stage.className = 'pptxv-slide-stage';
    stage.style.setProperty('--slide-width', `${slide.width}px`);
    stage.style.setProperty('--slide-ratio', String(slide.width / slide.height));
    stage.style.aspectRatio = `${slide.width} / ${slide.height}`;
    dialog.append(back, stage);
    this.root.append(dialog);

    const fit = () => {
      const scene = stage.firstElementChild as HTMLElement | null;
      if (scene) scene.style.transform = `scale(${stage.getBoundingClientRect().width / slide.width})`;
    };
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(fit);
    const translate = () => {
      dialog.setAttribute('aria-label', this.options.translate(label));
      back.textContent = this.options.translate('Back to document');
    };
    const refresh = () => {
      translate();
      const scene = renderSlideToElement(slide, presentation, { mediaRegistry: registry, translate: this.options.translate });
      for (const link of scene.querySelectorAll('a')) {
        for (const attr of ['href', 'tabindex', 'data-slide-index', 'data-slide-action']) link.removeAttribute(attr);
      }
      scene.style.transformOrigin = 'top left';
      stage.replaceChildren(scene);
      fit();
      const highlight = renderCommentLocation(slide, scene, location);
      if (highlight) scene.append(highlight.element);
    };
    const close = () => {
      this.commentSource = undefined;
      resize?.disconnect();
      dialog.close();
      dialog.remove();
    };
    const backToDocument = () => {
      close();
      (trigger.isConnected ? trigger : this.comments.summary).focus({ preventScroll: true });
    };
    back.addEventListener('click', backToDocument);
    dialog.addEventListener('cancel', event => {
      event.preventDefault();
      backToDocument();
    });
    this.commentSource = { refresh, close };
    translate();
    dialog.showModal();
    refresh();
    resize?.observe(stage);
  }

  private locateComment(anchor: SlideCommentAnchor, location: CommentLocation, button: HTMLButtonElement): void {
    const { slideIndex } = location;
    const presentation = this.presentation;
    const crossSlide = slideIndex !== this.state.currentSlide;
    this.animation.reset();
    this.beginProgrammaticNavigation('instant');
    this.navigationTargetSlide = slideIndex;
    this.setCurrentSlide(slideIndex);
    if (presentation !== this.presentation || slideIndex !== this.state.currentSlide || !this.comments.details.open) return;
    this.locatedComment = { anchor, location };
    this.scrollArea.classList.add('pptxv-scroll-area--comment-location');
    this.paintCommentLocation();
    if (crossSlide) {
      const stage = this.mountedStages.get(slideIndex);
      if (stage) {
        stage.tabIndex = -1;
        stage.focus({ preventScroll: true });
      }
    } else {
      this.comments.body.querySelector('.pptxv-comment-locate[aria-pressed="true"]')?.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-pressed', 'true');
    }
  }

  private paintCommentLocation(): void {
    if (!this.locatedComment) return;
    this.commentHighlight?.remove();
    this.commentHighlight = undefined;
    const { location } = this.locatedComment;
    const slide = this.presentation?.slides[location.slideIndex];
    const root = this.slideRoots.get(location.slideIndex);
    if (!slide || !root) return;
    const highlight = renderCommentLocation(slide, root, location);
    if (!highlight) return;
    this.commentHighlight = highlight.element;
    root.appendChild(highlight.element);

    const area = this.scrollArea;
    const viewport = area.getBoundingClientRect();
    const slideBox = root.getBoundingClientRect();
    const { left, top, right, bottom } = highlight.bounds;
    // Keep the target slide in view and show the leading edge of oversized highlights.
    const centerInSlide = (first: number, last: number, start: number, end: number, size: number) => {
      const target = first + Math.min(last - first, size) / 2;
      return end - start <= size ? (start + end) / 2 : clamp(target, start + size / 2, end - size / 2);
    };
    const x = centerInSlide(left, right, slideBox.left, slideBox.right, area.clientWidth);
    const y = centerInSlide(top, bottom, slideBox.top, slideBox.bottom, area.clientHeight);
    const scrollLeft = area.scrollLeft + x - viewport.left - area.clientLeft - area.clientWidth / 2;
    const scrollTop = area.scrollTop + y - viewport.top - area.clientTop - area.clientHeight / 2;
    if (area.scrollTo) area.scrollTo({ left: scrollLeft, top: scrollTop, behavior: 'instant' });
    else { area.scrollLeft = scrollLeft; area.scrollTop = scrollTop; }
  }

  private clearCommentLocation(): void {
    this.commentSource?.close();
    if (!this.locatedComment) return;
    this.locatedComment = undefined;
    this.commentHighlight?.remove();
    this.commentHighlight = undefined;
    this.scrollArea.classList.remove('pptxv-scroll-area--comment-location');
  }

  private bindResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    this.resizeObserver = new ResizeObserver(() => {
      if (this.presentation && this.state.fit !== 'none') {
        this.applyFitScale();
        this.layoutSlides();
      }
    });
    this.resizeObserver.observe(this.root);
  }

  private bindSlideTracking(): void {
    this.scrollArea.removeEventListener('scroll', this.handleFallbackScroll);
    this.scrollArea.addEventListener('scroll', this.handleFallbackScroll, { passive: true });
    for (const event of ['wheel', 'touchstart', 'pointerdown']) {
      this.scrollArea.removeEventListener(event, this.handleNavigationInterruption);
      this.scrollArea.addEventListener(event, this.handleNavigationInterruption, { passive: true });
    }

    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.handleFallbackScroll);
      window.removeEventListener('resize', this.handleFallbackScroll);
      window.addEventListener('scroll', this.handleFallbackScroll, { passive: true });
      window.addEventListener('resize', this.handleFallbackScroll, { passive: true });
    }
  }

  private readonly handleFallbackScroll = () => {
    if (this.fallbackScrollRaf) {
      return;
    }

    this.fallbackScrollRaf = requestAnimationFrame(() => {
      this.fallbackScrollRaf = 0;
      this.syncCurrentSlideToViewport();
    });
  };

  private readonly handleNavigationInterruption = () => {
    this.clearSlideTransition();
    if (this.navigationTargetSlide == null) return;
    this.navigationSourceSlide = null;
    this.clearNavigationSettleTimer();
    this.handleFallbackScroll();
  };

  private syncCurrentSlideToViewport(): void {
    // Smooth scrolling crosses other slides; keep rapid Next/Prev actions
    // relative to the requested destination until navigation settles.
    if (this.navigationTargetSlide != null) {
      this.syncMountedSlides();
      return;
    }
    const trackedIndex = this.findTrackedSlideIndex();
    if (trackedIndex == null) {
      return;
    }

    this.setCurrentSlide(trackedIndex);
  }

  private findTrackedSlideIndex(): number | null {
    if (!this.shells.length) {
      return null;
    }

    const viewport = this.getTrackingViewport();
    if (!viewport) {
      return null;
    }

    let bestVisibleIndex: number | null = null;
    let bestVisibleRatio = -1;
    let bestVisibleDistance = Number.POSITIVE_INFINITY;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;

    // Slide shells form an ordered vertical stack. Locate the viewport with
    // logarithmic layout reads instead of measuring every slide on each scroll.
    const rects = new Map<number, DOMRect>();
    const readRect = (index: number) => {
      let rect = rects.get(index);
      if (!rect) { rect = this.shells[index].getBoundingClientRect(); rects.set(index, rect); }
      return rect;
    };
    let low = 0, high = this.shells.length, scanAll = false;
    while (low < high) {
      const middle = Math.floor((low + high) / 2), rect = readRect(middle);
      if (!Number.isFinite(rect.top) || !Number.isFinite(rect.height) || rect.height <= 0) {
        scanAll = true;
        break;
      }
      if (rect.bottom <= viewport.top) low = middle + 1;
      else high = middle;
    }
    for (let index = scanAll ? 0 : Math.max(0, low - 1); index < this.shells.length; index++) {
      const rect = readRect(index);
      if (!Number.isFinite(rect.top) || !Number.isFinite(rect.height) || rect.height <= 0) {
        continue;
      }

      const shellCenter = rect.top + rect.height / 2;
      const centerDistance = Math.abs(shellCenter - viewport.center);
      if (centerDistance < nearestDistance) {
        nearestDistance = centerDistance;
        nearestIndex = index;
      }

      const visibleTop = Math.max(rect.top, viewport.top);
      const visibleBottom = Math.min(rect.bottom, viewport.bottom);
      const visibleHeight = visibleBottom - visibleTop;
      if (visibleHeight <= 0) {
        if (!scanAll && rect.top >= viewport.bottom) break;
        continue;
      }

      const visibleRatio = visibleHeight / rect.height;
      const visibleCenter = visibleTop + visibleHeight / 2;
      const visibleDistance = Math.abs(visibleCenter - viewport.center);

      if (
        visibleRatio > bestVisibleRatio + 0.0001 ||
        (Math.abs(visibleRatio - bestVisibleRatio) <= 0.0001 && visibleDistance < bestVisibleDistance)
      ) {
        bestVisibleIndex = index;
        bestVisibleRatio = visibleRatio;
        bestVisibleDistance = visibleDistance;
      }
    }

    return bestVisibleIndex ?? nearestIndex;
  }

  private getTrackingViewport(): { top: number; bottom: number; center: number } | null {
    const rect = this.scrollArea.getBoundingClientRect();
    if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) {
      return null;
    }

    const viewportHeight =
      typeof window !== 'undefined'
        ? window.innerHeight || document.documentElement.clientHeight || rect.height
        : rect.height;

    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, viewportHeight);
    if (bottom <= top) {
      return null;
    }

    return {
      top,
      bottom,
      center: top + (bottom - top) / 2
    };
  }

  private readonly handleLinkClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target.closest('[data-slide-index], [data-slide-action]') : null;
    if (!(target instanceof HTMLAnchorElement)) {
      return;
    }

    const navigationAction = target.dataset.slideAction;
    if (navigationAction) {
      event.preventDefault();

      switch (navigationAction) {
        case 'next':
          this.next();
          return;
        case 'previous':
          this.prev();
          return;
        case 'first':
          this.goToSlide(0);
          return;
        case 'last':
          this.goToSlide(Math.max((this.presentation?.slides.length ?? 1) - 1, 0));
          return;
        case 'lastViewed':
          if (this.lastViewedSlide != null) {
            this.goToSlide(this.lastViewedSlide);
          }
          return;
        default:
          return;
      }
    }

    const slideIndex = Number(target.dataset.slideIndex);
    if (!Number.isFinite(slideIndex)) {
      return;
    }

    event.preventDefault();
    this.goToSlide(slideIndex);
  };

  private setCurrentSlide(index: number): void {
    if (index === this.state.currentSlide) {
      this.syncMountedSlides();
      return;
    }

    this.clearSlideTransition();
    const previousScale = this.state.scale;
    const previousSlide = this.state.currentSlide;
    this.lastViewedSlide = this.navigationSourceSlide ?? previousSlide;
    this.animation.select(this.presentation?.slides[index]?.animations);
    this.state.currentSlide = index;
    this.clearCommentLocation();
    this.speakerNotes.body.scrollTop = 0;
    this.comments.body.scrollTop = 0;
    this.syncSlidePanels();
    if (this.state.fit !== 'none') {
      this.applyFitScale();
      this.layoutSlides();
    } else {
      this.syncMountedSlides();
    }
    this.emit('slidechange', this.getState());
    if (this.state.scale !== previousScale) {
      this.emit('scalechange', this.getState());
    }
  }

  private beginProgrammaticNavigation(behavior = getPreferredScrollBehavior()): void {
    this.clearSlideTransition();
    this.navigationSourceSlide = this.state.currentSlide;
    this.clearNavigationSettleTimer();
    if (typeof window === 'undefined') {
      return;
    }

    const releaseDelay = behavior === 'smooth' ? 700 : 50;
    this.navigationSettleTimer = window.setTimeout(() => {
      this.navigationSettleTimer = 0;
      this.navigationSourceSlide = null;
      this.navigationTargetSlide = null;
      this.syncCurrentSlideToViewport();
    }, releaseDelay);
  }

  private clearNavigationSettleTimer(): void {
    this.navigationTargetSlide = null;
    if (!this.navigationSettleTimer) {
      return;
    }

    clearTimeout(this.navigationSettleTimer);
    this.navigationSettleTimer = 0;
  }

  private clearSlideTransition(): void {
    if (!this.stopSlideTransition) return;
    this.stopSlideTransition();
    this.releaseSlideTransition();
  }

  private readonly releaseSlideTransition = () => {
    this.stopSlideTransition = undefined;
    this.flushFontRefresh();
  };

  private flushFontRefresh(): void {
    if (this.pendingFontRefresh) {
      this.pendingFontRefresh = false;
      const presentation = this.presentation;
      queueMicrotask(() => {
        if (this.presentation === presentation) this.refreshFonts();
      });
    }
  }

  private applyFitScale(): void {
    if (!this.presentation?.slides.length) {
      return;
    }

    const slide = this.presentation.slides[this.state.currentSlide] ?? this.presentation.slides[0];
    const usableWidth = Math.max(this.scrollArea.clientWidth - 24, 120);
    const usableHeight = Math.max(this.scrollArea.clientHeight - 24, 120);
    const widthScale = usableWidth / slide.width;
    const containScale = Math.min(widthScale, usableHeight / slide.height);

    const scale = clamp(
      this.state.fit === 'width' ? widthScale : containScale,
      this.options.minScale,
      this.options.maxScale
    );
    if (scale !== this.state.scale) this.clearSlideTransition();
    this.state.scale = scale;
  }

  private beginLoadingState(): void {
    this.mediaRegistry?.destroy();
    this.mediaRegistry = null;
    this.presentation = null;
    this.resetSlidePanels();
    this.lastViewedSlide = null;
    this.navigationSourceSlide = null;
    this.clearNavigationSettleTimer();
    this.state.loading = true;
    this.state.error = null;
    this.state.presentation = null;
    this.state.mediaRegistry = null;
    this.state.currentSlide = 0;
    this.state.slideCount = 0;
    this.state.warnings = [];
  }

  private clearRenderedSlides(): void {
    this.clearSlideTransition();
    this.clearNavigationSettleTimer();
    this.navigationSourceSlide = null;
    if (this.fallbackScrollRaf) {
      cancelAnimationFrame(this.fallbackScrollRaf);
      this.fallbackScrollRaf = 0;
    }
    this.scrollArea.removeEventListener('scroll', this.handleFallbackScroll);
    for (const event of ['wheel', 'touchstart', 'pointerdown']) {
      this.scrollArea.removeEventListener(event, this.handleNavigationInterruption);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('scroll', this.handleFallbackScroll);
      window.removeEventListener('resize', this.handleFallbackScroll);
    }
    this.shells = [];
    this.mountedSlides.clear();
    this.mountedStages.clear();
    this.slideRoots.clear();
    this.scrollArea.innerHTML = '';
  }
}

export function createViewer(container: HTMLElement, options?: ViewerOptions): ViewerInstance {
  return new PptxViewer(container, options);
}

export const init = createViewer;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function getPreferredScrollBehavior(): ScrollBehavior {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'smooth';
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
}
