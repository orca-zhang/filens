import JSZip from 'jszip';
import * as core from '@filens/core';
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEbookPreviewDriver, loadCbzBook } from '../src';
import { createBookFixture, createComicFixture, createNavigationBookFixture } from './fixtures/books.mjs';

let active: Set<string>, sequence = 0;
const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
beforeEach(() => {
  active = new Set();
  vi.stubGlobal('Blob', NodeBlob);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => {
    const url = `blob:page-${++sequence}`; active.add(url); return url;
  }) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn((url: string) => { active.delete(url); }) });
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren();
  if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate); else Reflect.deleteProperty(URL, 'createObjectURL');
  if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke); else Reflect.deleteProperty(URL, 'revokeObjectURL');
});

async function illustratedBook(count = 3, pending = false) {
  const zip = await JSZip.loadAsync(await createBookFixture(count, 1));
  for (let index = 1; index <= count; index++) {
    const file = zip.file(`OPS/chapter-${index}.xhtml`)!;
    zip.file(file.name, (await file.async('text')).replace('</body>', `<img src="images/${index}.svg"/>${pending && index === 2 ? '<img src="waiting.svg"/>' : ''}</body>`));
    zip.file(`OPS/images/${index}.svg`, `<svg xmlns="http://www.w3.org/2000/svg"><text>${index}</text></svg>`);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

async function open(bytes: Uint8Array, extension = 'epub', options: core.PreviewOptions = {}) {
  const host = document.body.appendChild(document.createElement('div'));
  const session = createEbookPreviewDriver().createSession(host, options);
  await session.load(bytes, { descriptor: { source: bytes, name: `book.${extension}`, extension } });
  return { session, host };
}

describe('on-demand ebook previews', () => {
  it('preserves full-extraction URL callback order when comic pages finish decompressing out of order', async () => {
    const bytes = await createComicFixture(2), entries = await core.openZipArchive(bytes);
    const first = entries.get('pages/page-1.svg')!, read = first.bytes;
    vi.spyOn(first, 'bytes').mockImplementationOnce(async (...args) => {
      await new Promise(resolve => setTimeout(resolve, 30)); return read(...args);
    });
    vi.spyOn(core, 'openZipArchive').mockResolvedValueOnce(entries);
    const blobs: Blob[] = [];
    const book = await loadCbzBook(bytes, undefined, blob => { blobs.push(blob); return `blob:ordered-${blobs.length}`; });
    const images = await Promise.all(blobs.map(blob => blob.text()));
    expect(images[0]).toContain('>Page 1</text>'); expect(images[1]).toContain('>Page 2</text>');
    expect(book.chapters[0].html).toContain('blob:ordered-1');
    expect(book.chapters[1].html).toContain('blob:ordered-2');
  });

  it('opens only the selected EPUB chapter and assets, retaining one chapter URL set across distant navigation', async () => {
    const bytes = await illustratedBook(100);
    const entries = await core.openZipArchive(bytes);
    const unread = ['OPS/chapter-2.xhtml', 'OPS/images/2.svg', 'OPS/chapter-100.xhtml', 'OPS/images/100.svg']
      .map(path => vi.spyOn(entries.get(path)!, 'bytes'));
    vi.spyOn(core, 'openZipArchive').mockResolvedValueOnce(entries);
    const { session, host } = await open(bytes);
    try {
      expect(session.getState()).toMatchObject({ chapterCount: 100, chapterTitle: 'Chapter 1', loading: false });
      for (const read of unread) expect(read).not.toHaveBeenCalled();
      expect(active.size).toBe(1);
      const firstFrame = host.querySelector('iframe');
      session.goToPage?.(99);
      await vi.waitFor(() => expect(session.getState()).toMatchObject({ chapterTitle: 'Chapter 100', loading: false }));
      expect(host.querySelector('iframe')).not.toBe(firstFrame);
      expect(unread[0]).not.toHaveBeenCalled(); expect(unread[1]).not.toHaveBeenCalled();
      expect(unread[2]).toHaveBeenCalledTimes(1); expect(unread[3]).toHaveBeenCalledTimes(1);
      expect(active.size).toBe(1);
      session.goToPage?.(0);
      await vi.waitFor(() => expect(session.getState()).toMatchObject({ chapterTitle: 'Chapter 1', loading: false }));
      expect(active.size).toBe(1);
      const state = session.getState(); state.chapters[0].title = 'changed';
      expect(session.getState().chapters[0].title).toBe('Chapter 1');
    } finally { session.destroy(); }
    expect(active.size).toBe(0);
  });

  it('does not inflate unread CBZ pages and releases the old image on each turn', async () => {
    const bytes = await createComicFixture(200), entries = await core.openZipArchive(bytes);
    const first = vi.spyOn(entries.get('pages/page-1.svg')!, 'bytes');
    const second = vi.spyOn(entries.get('pages/page-2.svg')!, 'bytes');
    const last = vi.spyOn(entries.get('pages/page-200.svg')!, 'bytes');
    vi.spyOn(core, 'openZipArchive').mockResolvedValueOnce(entries);
    const { session, host } = await open(bytes, 'cbz');
    try {
      expect(first).toHaveBeenCalledTimes(1); expect(second).not.toHaveBeenCalled(); expect(last).not.toHaveBeenCalled();
      expect(active.size).toBe(1);
      session.goToPage?.(199);
      await vi.waitFor(() => expect(session.getState()).toMatchObject({ chapterTitle: 'Page 200', chapterLoading: false }));
      expect(last).toHaveBeenCalledTimes(1); expect(second).not.toHaveBeenCalled();
      expect(host.querySelector('iframe')?.srcdoc).toContain('Page 200');
      expect(active.size).toBe(1);
    } finally { session.destroy(); }
    expect(active.size).toBe(0);
  });

  it.each(['epub3', 'ncx'])('uses %s navigation titles without reading unopened chapter bodies', async kind => {
    const zip = await JSZip.loadAsync(await createBookFixture(2, 1));
    const manifest = zip.file('OPS/package.opf')!;
    zip.file(manifest.name, (await manifest.async('text')).replace('</manifest>', kind === 'epub3'
      ? '<item id="nav" href="toc/nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>'
      : '<item id="nav" href="toc/nav.ncx" media-type="application/x-dtbncx+xml"/></manifest>'));
    zip.file(`OPS/toc/nav.${kind === 'epub3' ? 'xhtml' : 'ncx'}`, kind === 'epub3'
      ? '<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><a href="../chapter-2.xhtml#p0">Unread title</a></nav></body></html>'
      : '<ncx><navMap><navPoint><navLabel><text>Unread title</text></navLabel><content src="../chapter-2.xhtml#p0"/></navPoint></navMap></ncx>');
    const bytes = await zip.generateAsync({ type: 'uint8array' }), entries = await core.openZipArchive(bytes);
    const body = vi.spyOn(entries.get('OPS/chapter-2.xhtml')!, 'bytes');
    vi.spyOn(core, 'openZipArchive').mockResolvedValueOnce(entries);
    const { session } = await open(bytes);
    try {
      expect(body).not.toHaveBeenCalled();
      expect(session.getState().chapters[1].title).toBe('Unread title');
    } finally { session.destroy(); }
  });

  it('uses EPUB 2 NCX if the EPUB 3 navigation has no targets in the spine', async () => {
    const zip = await JSZip.loadAsync(await createNavigationBookFixture('ncx'));
    const manifest = zip.file('OPS/package.opf')!;
    zip.file(manifest.name, (await manifest.async('text')).replace('</manifest>',
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest>'));
    zip.file('OPS/nav.xhtml', '<html><nav><a href="missing.xhtml">Missing chapter</a></nav></html>');
    const { session, host } = await open(await zip.generateAsync({ type: 'uint8array' }));
    try {
      expect(session.getState().chapters[1].title).toBe('Deep sky');
      expect(host.querySelector('.ebookv-contents')?.textContent).toContain('Winter sky');
    } finally { session.destroy(); }
  });

  it('retargets a pending chapter to another fragment without starting a second read', async () => {
    const bytes = await createNavigationBookFixture(), entries = await core.openZipArchive(bytes);
    const chapter = entries.get('OPS/chapter 2.xhtml')!;
    const read = chapter.bytes;
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    const held = vi.spyOn(chapter, 'bytes').mockImplementation(async (...args) => { await pending; return read(...args); });
    vi.spyOn(core, 'openZipArchive').mockResolvedValueOnce(entries);
    const { session, host } = await open(bytes);
    try {
      const [first, second] = host.querySelectorAll<HTMLButtonElement>('.ebookv-contents button');
      first.click();
      await vi.waitFor(() => expect(held).toHaveBeenCalledOnce());
      const previous = host.querySelector('iframe');
      second.click();
      expect(session.getState()).toMatchObject({ chapterLoading: true, location: 'chapter%202.xhtml#p79' });
      expect(host.querySelector('iframe')).toBe(previous);
      finish();
      await vi.waitFor(() => expect(session.getState()).toMatchObject({ chapterLoading: false, location: 'chapter%202.xhtml#p79' }));
      expect(held).toHaveBeenCalledOnce();
    } finally { finish(); session.destroy(); }
  });

  it.each(['Error', 'AbortError'])('keeps navigation usable after a chapter reader reports %s without cancelling the session', async name => {
    const bytes = await illustratedBook(), entries = await core.openZipArchive(bytes);
    const error = new Error('Chapter read failed'); error.name = name;
    vi.spyOn(entries.get('OPS/chapter-2.xhtml')!, 'bytes').mockRejectedValueOnce(error);
    vi.spyOn(core, 'openZipArchive').mockResolvedValueOnce(entries);
    const { session, host } = await open(bytes);
    try {
      const frame = host.querySelector('iframe');
      session.next?.();
      await vi.waitFor(() => expect(session.getState().error).toBe('Chapter read failed'));
      expect(session.getState().chapterLoading).toBe(false);
      expect(host.querySelector('iframe')).toBe(frame); expect(active.size).toBe(1);
      session.goToPage?.(1);
      await vi.waitFor(() => expect(session.getState()).toMatchObject({ error: null, chapterTitle: 'Chapter 2', loading: false }));
      expect(active.size).toBe(1);
    } finally { session.destroy(); }
  });

  it('cancels a slow chapter on a new selection and never publishes its late assets or warnings', async () => {
    let finish!: (value: Blob) => void;
    const resolver = vi.fn(() => new Promise<Blob>(resolve => { finish = resolve; }));
    const { session, host } = await open(await illustratedBook(3, true), 'epub', { resourceResolver: resolver });
    const errors = vi.fn(); session.on('error', errors);
    try {
      const previous = host.querySelector('iframe');
      session.goToPage?.(1);
      await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
      expect(host.querySelector('iframe')).toBe(previous); expect(active.size).toBe(2);
      expect(session.getState()).toMatchObject({ loading: false, chapterLoading: true });
      session.goToPage?.(2);
      await vi.waitFor(() => expect(session.getState()).toMatchObject({ chapterTitle: 'Chapter 3', loading: false }));
      const created = vi.mocked(URL.createObjectURL).mock.calls.length;
      finish(new Blob(['<svg/>'], { type: 'image/svg+xml' }));
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(vi.mocked(URL.createObjectURL).mock.calls).toHaveLength(created);
      expect(session.getState()).toMatchObject({ chapterTitle: 'Chapter 3', warnings: [], error: null });
      expect(active.size).toBe(1); expect(errors).not.toHaveBeenCalled();
    } finally { session.destroy(); }
  });

  it('clears pending and active resources on destruction without waiting for the resolver', async () => {
    let finish!: (value: Blob) => void;
    const resolver = vi.fn(() => new Promise<Blob>(resolve => { finish = resolve; }));
    const { session, host } = await open(await illustratedBook(3, true), 'epub', { resourceResolver: resolver });
    session.goToPage?.(1);
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
    session.destroy(); expect(active.size).toBe(0); expect(host.childElementCount).toBe(0);
    const created = vi.mocked(URL.createObjectURL).mock.calls.length;
    finish(new Blob(['<svg/>'], { type: 'image/svg+xml' }));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(vi.mocked(URL.createObjectURL).mock.calls).toHaveLength(created);
  });
});
