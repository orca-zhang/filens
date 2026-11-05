import './style.css';

import IworkPreview from './IworkPreview.vue';
import PptxPreview from './PptxPreview.vue';
import Preview from './Preview.vue';

export { createVueDefaultPreviewRoutes } from './defaults';
export { createVueDefaultPreviewDrivers } from './lazy-drivers';
export { IworkPreview, PptxPreview, Preview };
export default PptxPreview;

export { previewLocales, resolvePreviewLocale, translatePreview } from './i18n';
export type { PreviewLocale, PreviewMessages } from './i18n';
