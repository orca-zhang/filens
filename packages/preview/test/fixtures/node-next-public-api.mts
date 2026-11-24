import { createPreview, type BrowserPreview } from 'filens-preview-split';

const viewer: BrowserPreview = createPreview(document.body, {
  src: new File(['Node 24'], 'node24.txt'),
  onError: error => console.error(error.message)
});
viewer.update({ src: new Uint8Array([65]), name: 'updated.txt' });
viewer.destroy();
