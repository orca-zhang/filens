# @filens/pptx

Browser-local PowerPoint preview for modern ESM applications. Install it with
`@filens/core` for shared ZIP, font, and scene rendering support.

```sh
npm install @filens/pptx @filens/core
```

```ts
import { createViewer } from '@filens/pptx';
import '@filens/pptx/style.css';

const viewer = createViewer(document.querySelector<HTMLElement>('#preview')!);
await viewer.preview('/slides.pptx');
// Call viewer.destroy() when the host is removed.
```

Use `loadPptx()` and `renderSlideToElement()` for a custom viewer, or
`createPptxPreviewDriver()` to register PowerPoint support in a preview host.
Existing imports from `@filens/core` continue to use the same implementation.

Presentations with speaker notes show a collapsed panel below the slide viewport.
`loadPptx()` also exposes plain-text `speakerNotes` on each slide with notes.
The PPTX preview driver exposes the active slide's notes on `PagedPreviewState.speakerNotes`.

Legacy and modern PowerPoint comments appear in a read-only panel for the current
slide. **Locate on slide** scrolls to a comment's slide, point, shape, group or
matching text range. Use `SlideModel.comments` or `PagedPreviewState.comments`
to read the threads, source anchors, author names, timestamps and resolution
status. Modern comment and reply reactions show their authors and times on
expansion. Task fields and the authored change history are also available in
the panel and the parsed comment model.

OLE frames show their cached picture, including EMF and WMF decoded in frontend
WebAssembly. The parsed media retains the original picture bytes. In the shared
preview, activate a local object on the slide to open its embedded file and
return to the same slide. Undecodable OLE pictures use a labeled placeholder.
