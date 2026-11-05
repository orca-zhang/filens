import { createApp, h, shallowReactive, shallowRef } from 'vue';
import type { BrowserMediaOptions } from '@filens/media';
import { Preview } from '@filens/vue';
import type { ConverterClient, PreviewOptions, PreviewSource, SourceDescriptor } from '@filens/core';
import { createWasmConverterClient } from '@filens/converter-client';
import { createWasmPanoramaProcessor, type PanoramaProcessor } from '@filens/panorama';
import coreWasm from '../../../wasm/converter-core/dist/converter-core.wasm?url';
import imageWasm from '../../../wasm/converter-image/dist/converter-image.wasm?url';
import officeWasm from '../../../wasm/converter-core/dist/converter-office.wasm?url';
import postscriptWasm from '../../../wasm/converter-core/dist/converter-postscript.wasm?url';
import graphicsWasm from '../../../wasm/converter-core/dist/converter-graphics.wasm?url';
export { isArchiveVolumeName, selectArchiveVolumes } from '@filens/core/archive-volumes';

export interface BrowserPreviewOptions extends PreviewOptions {
  src: PreviewSource | SourceDescriptor;
  name?: string;
  extension?: string;
  toolbar?: boolean | 'minimal';
  /** Render all preview controls beside the host application's address bar. */
  controlsTarget?: HTMLElement;
  /** ZimaOS codes (zh_CN) and BCP 47 tags (zh-CN); defaults to browser language. */
  locale?: string;
  /** English source phrases mapped to host translations. */
  messages?: Readonly<Record<string, string>>;
  converter?: ConverterClient;
  mediaConverter?: ConverterClient;
  browserMedia?: boolean | BrowserMediaOptions;
  panoramaProcessor?: PanoramaProcessor;
  onRendered?: (state: unknown) => void;
  onError?: (error: Error) => void;
}

/** Mount the shared Vue preview host; no framework installation is required. */
export function createPreview(element: Element | string, options: BrowserPreviewOptions) {
  const props = shallowReactive({
    ...options,
    converter: options.converter ?? createWasmConverterClient({ wasm: coreWasm, imageWasm, officeWasm, postscriptWasm, graphicsWasm }),
    panoramaProcessor: options.panoramaProcessor ?? createWasmPanoramaProcessor({ wasm: coreWasm, imageWasm })
  });
  const preview = shallowRef<InstanceType<typeof Preview>>();
  const app = createApp({ render: () => h(Preview, { ...props, ref: preview }) });
  app.mount(element);
  return {
    /** Switch sources using the shared preview lifecycle and cancellation. */
    update(next: Partial<BrowserPreviewOptions>) { Object.assign(props, next); },
    /** Controls for applications that supply their own toolbar. */
    getState() { return preview.value?.getState(); },
    setScale(scale: number) { preview.value?.setScale(scale); },
    fullscreen() { return preview.value?.fullscreen(); },
    destroy() { app.unmount(); }
  };
}
