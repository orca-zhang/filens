import JSZip from 'jszip';
import * as cfb from 'cfb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readOfficeAttachments, unwrapOfficeAttachment } from '../src/parser/attachments';
import { createPreviewContainerContext, descendPreviewContainer, PREVIEW_CONTAINER_LIMITS, readPreviewContainerEntry, readWithPreviewPassword } from '../src/preview/containers';
import { PreviewPasswordError } from '../src/preview/password';
import { createPreviewer, createDefaultPreviewRoutes, createTextPreviewDriver } from '../src/preview';
import { createAttachmentPreviewSession } from '../src/preview/attachment-session';
import type { PreviewDriver, PreviewerInstance, PreviewItemState } from '../src/preview';

const encode = (text: string) => new TextEncoder().encode(text);

function olePackage(name: string, data: Uint8Array): Uint8Array {
  const strings = encode(`${name}\0C:\\original\\${name}\0`);
  const temporary = encode(`C:\\temp\\${name}\0`);
  const stream = new Uint8Array(6 + strings.length + 4 + temporary.length + 4 + data.length);
  const view = new DataView(stream.buffer);
  view.setUint32(0, stream.length - 4, true);
  view.setUint16(4, 2, true);
  stream.set(strings, 6);
  let offset = 6 + strings.length + 4;
  stream.set(temporary, offset);
  offset += temporary.length;
  view.setUint32(offset, data.length, true);
  stream.set(data, offset + 4);
  const file = cfb.utils.cfb_new();
  cfb.utils.cfb_add(file, '\u0001Ole10Native', stream);
  return new Uint8Array(cfb.write(file, { type: 'array' }));
}

async function office(files: Record<string, Uint8Array | string>, root = 'word'): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(`${root}/document.xml`, '<document/>');
  zip.file(`${root}/media/picture.png`, 'not an attachment');
  for (const [name, source] of Object.entries(files)) zip.file(`${root}/embeddings/${name}`, source);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

describe('Office embedded payloads', () => {
  it.each(['word', 'xl', 'ppt'])('indexes %s payloads without expanding them, and excludes document resources', async root => {
    const bytes = await office({ 'hello.txt': 'Embedded text', 'oleObject1.bin': olePackage('bundle.zip', encode('payload')) }, root);
    const context = createPreviewContainerContext();
    const attachments = await readOfficeAttachments(bytes, context);
    expect(attachments.map(entry => entry.name)).toEqual(['hello.txt', 'oleObject1.bin']);
    expect(context.budget.expandedBytes).toBe(0);
    const text = await attachments[0].read();
    expect(text.name).toBe('hello.txt');
    expect(new TextDecoder().decode(text.source as Uint8Array)).toBe('Embedded text');
    const packaged = await attachments[1].read();
    expect(packaged.name).toBe('bundle.zip');
    expect(new TextDecoder().decode(packaged.source as Uint8Array)).toBe('payload');
  });

  it('identifies anonymous ZIP and native Office compound objects', async () => {
    const zip = new JSZip(); zip.file('inside.txt', 'nested');
    const payload = await zip.generateAsync({ type: 'uint8array' });
    expect(await unwrapOfficeAttachment(payload, 'oleObject.bin')).toMatchObject({ name: 'oleObject.zip', extension: 'zip' });
    const file = cfb.utils.cfb_new(); cfb.utils.cfb_add(file, 'Workbook', encode('legacy workbook'));
    expect(await unwrapOfficeAttachment(new Uint8Array(cfb.write(file, { type: 'array' })), 'oleObject.bin'))
      .toMatchObject({ name: 'oleObject.xls', extension: 'xls' });
  });

  it('rejects a truncated OLE payload and sanitizes embedded filenames', async () => {
    const descriptor = await unwrapOfficeAttachment(olePackage('C:\\temp\\safe.txt', encode('safe')), 'object.bin');
    expect(descriptor.name).toBe('safe.txt');
    const file = cfb.utils.cfb_new();
    cfb.utils.cfb_add(file, '\u0001Ole10Native', new Uint8Array([255, 255, 255, 255, 2, 0]));
    await expect(unwrapOfficeAttachment(new Uint8Array(cfb.write(file, { type: 'array' })), 'object.bin')).rejects.toThrow('truncated');
  });

  it.each([
    ['rar', [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 1, 0]],
    ['7z', [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]]
  ])('recognizes an anonymous embedded %s archive', async (extension, signature) => {
    expect(await unwrapOfficeAttachment(new Uint8Array(signature as number[]), 'object.bin'))
      .toMatchObject({ name: `object.${extension}`, extension });
  });

  it('preserves a split archive filename while routing it to its archive format', async () => {
    expect(await unwrapOfficeAttachment(encode('a continuation volume'), 'bundle.7z.002'))
      .toMatchObject({ name: 'bundle.7z.002', extension: '7z' });
  });
});

describe('nested preview limits and password lifetime', () => {
  it('limits depth and shares the expanded-byte budget across mixed container types', async () => {
    const context = createPreviewContainerContext();
    let nested = context;
    for (let i = 0; i < PREVIEW_CONTAINER_LIMITS.maxDepth; i++) nested = descendPreviewContainer(nested);
    expect(() => descendPreviewContainer(nested)).toThrow('depth');
    context.budget.expandedBytes = PREVIEW_CONTAINER_LIMITS.maxExpandedBytes - 2;
    const read = vi.fn(async () => new Uint8Array(4));
    await expect(readPreviewContainerEntry(read, 4, nested)).rejects.toThrow('limit');
    expect(read).not.toHaveBeenCalled();
    expect(nested.budget).toBe(context.budget);
  });

  it('retries a wrong password without retaining it in preview state and cancels a held callback', async () => {
    const requestPassword = vi.fn().mockResolvedValueOnce('wrong').mockResolvedValueOnce(' secret ');
    const read = vi.fn(async (password?: string) => {
      if (!password) throw new PreviewPasswordError('password_required');
      if (password !== ' secret ') throw new PreviewPasswordError('password_invalid');
      return 'opened';
    });
    await expect(readWithPreviewPassword(read, { requestPassword }, 'outer.zip › file.txt')).resolves.toBe('opened');
    expect(requestPassword.mock.calls.map(([request]) => [request.reason, request.attempt])).toEqual([['password_required', 1], ['password_invalid', 2]]);
    const controller = new AbortController();
    const pending = readWithPreviewPassword(read, { requestPassword: () => new Promise(() => {}) }, 'file.txt', controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('document attachment navigation', () => {
  const previewers: PreviewerInstance[] = [];
  afterEach(() => { previewers.splice(0).forEach(previewer => previewer.destroy()); document.body.replaceChildren(); });

  function setup() {
    const host = document.createElement('div'); document.body.append(host);
    const load = vi.fn();
    const driver: PreviewDriver = {
      id: 'document', family: 'flow', supports: format => format === 'docx',
      createSession(documentHost) {
        const state: PreviewItemState = { loading: false, error: null, family: 'flow', warnings: [], capabilities: {} };
        return { load: async () => { load(); documentHost.textContent = 'Parent document'; }, destroy: () => documentHost.replaceChildren(),
          getState: () => state, on: () => () => {} };
      }
    };
    const previewer = createPreviewer(host, { drivers: [driver, createTextPreviewDriver()],
      routes: createDefaultPreviewRoutes([{ extensions: ['docx'], family: 'flow', driverId: 'document', targetFormat: 'docx' }]) });
    previewers.push(previewer);
    return { host, previewer, load };
  }
  const click = (host: HTMLElement, text: string) => {
    const button = [...host.querySelectorAll('button')].find(element => element.textContent === text);
    expect(button).toBeDefined(); button!.click();
  };

  it('opens an embedded file, retains the parent document and returns without reloading', async () => {
    const { host, previewer, load } = setup();
    await previewer.preview(await office({ 'notes.txt': 'Child document text' }), { name: 'parent.docx' });
    expect(host.textContent).toContain('Attachments (1)');
    const documentHost = host.querySelector<HTMLElement>('.filens-attachments-document')!;
    documentHost.scrollTop = 123;
    const trigger = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'notes.txt')!;
    trigger.focus();
    click(host, 'notes.txt');
    await vi.waitFor(() => expect(host.querySelector('.filens-attachment-preview')?.textContent).toContain('Child document text'));
    expect(documentHost.hidden).toBe(true);
    click(host, 'Back to document');
    expect(documentHost.hidden).toBe(false);
    expect(documentHost.scrollTop).toBe(123);
    expect(document.activeElement).toBe(trigger);
    expect(load).toHaveBeenCalledOnce();
    expect(previewer.getState().error).toBeNull();
  });

  it('keeps unsupported attachment errors local, with download and return controls', async () => {
    const { host, previewer } = setup();
    await previewer.preview(await office({ 'unknown.custom-format': 'opaque payload' }), { name: 'parent.docx' });
    click(host, 'unknown.custom-format');
    await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('Unsupported preview format'));
    expect(previewer.getState().error).toBeNull();
    expect(host.textContent).toContain('Download attachment');
    click(host, 'Back to document');
    expect(host.querySelector('.filens-attachment-panel')).toBeNull();
    expect(host.textContent).toContain('Parent document');
  });

  it('aborts a held attachment read on return and ignores a late payload', async () => {
    const host = document.createElement('div');
    let resolve!: (value: { source: Uint8Array; name: string }) => void;
    const pending = new Promise<{ source: Uint8Array; name: string }>(yes => { resolve = yes; });
    const read = vi.fn((_signal?: AbortSignal) => pending);
    const factory = vi.fn();
    const parent: PreviewItemState = { family: 'paged', loading: false, error: null, warnings: [], capabilities: {} };
    const session = createAttachmentPreviewSession(host, { previewerFactory: factory }, 'pdf', documentHost => ({
      load: async () => { documentHost.textContent = 'Retained parent'; }, destroy: vi.fn(), getState: () => parent,
      on: () => () => {}, getAttachments: async () => [{ id: 'one', name: 'held.txt', read }]
    }));
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array(), name: 'parent.pdf' } });
      click(host, 'held.txt');
      await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
      click(host, 'Back to document');
      expect(read.mock.calls[0][0]?.aborted).toBe(true);
      resolve({ source: encode('Late child'), name: 'held.txt' });
      await new Promise(yes => setTimeout(yes, 0));
      expect(factory).not.toHaveBeenCalled();
      expect(host.querySelector('.filens-attachment-panel')).toBeNull();
      expect(host.textContent).toContain('Retained parent');
    } finally { session.destroy(); }
  });

  it('settles a held attachment index when destroyed and does not restore its controls', async () => {
    const host = document.createElement('div');
    let resolve!: (value: []) => void;
    const getAttachments = vi.fn(() => new Promise<[]>(yes => { resolve = yes; }));
    const parent: PreviewItemState = { family: 'paged', loading: false, error: null, warnings: [], capabilities: {} };
    const session = createAttachmentPreviewSession(host, {}, 'pdf', () => ({
      load: async () => {}, destroy: vi.fn(), getState: () => parent, on: () => () => {}, getAttachments
    }));
    const result = session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
    await vi.waitFor(() => expect(getAttachments).toHaveBeenCalledOnce());
    session.destroy();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    resolve([]);
    await new Promise(yes => setTimeout(yes, 0));
    expect(host.childNodes).toHaveLength(0);
  });

  it('retains attachment metadata failures as parent warnings', async () => {
    const host = document.createElement('div');
    const parent: PreviewItemState = { family: 'paged', loading: false, error: null, warnings: ['Renderer warning'], capabilities: {} };
    const session = createAttachmentPreviewSession(host, {}, 'pdf', () => ({
      load: async () => {}, destroy: vi.fn(), getState: () => parent, on: () => () => {},
      getAttachments: async () => { throw new Error('Broken metadata'); }
    }));
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
      expect(session.getState().error).toBeNull();
      expect(session.getState().warnings).toEqual(['Renderer warning', 'Some document attachments could not be read.']);
    } finally { session.destroy(); }
  });

  it('collects an anonymous OLE continuation when opening a legacy RAR attachment', async () => {
    const host = document.createElement('div');
    const parent: PreviewItemState = { family: 'paged', loading: false, error: null, warnings: [], capabilities: {} };
    const preview = vi.fn(async (_descriptor: unknown) => {});
    const child = { preview, destroy: vi.fn(), getState: () => parent, on: () => () => {} } as unknown as PreviewerInstance;
    const session = createAttachmentPreviewSession(host, { previewerFactory: () => child }, 'pdf', () => ({
      load: async () => {}, destroy: vi.fn(), getState: () => parent, on: () => () => {},
      getAttachments: async () => [
        { id: 'first', name: 'oleObject1.bin', read: async () => ({ name: 'old.rar', source: encode('first volume') }) },
        { id: 'second', name: 'oleObject2.bin', read: async () => ({ name: 'old.r00', source: encode('second volume') }) }
      ]
    }));
    try {
      await session.load(new Uint8Array(), { descriptor: { source: new Uint8Array() } });
      click(host, 'oleObject1.bin');
      await vi.waitFor(() => expect(preview).toHaveBeenCalledOnce());
      expect(preview.mock.calls[0][0]).toMatchObject({ name: 'old.rar', archiveVolumes: [{ name: 'old.r00', source: encode('second volume') }] });
    } finally { session.destroy(); }
  });

  it('allows downloading a corrupt OLE attachment after its preview fails', async () => {
    const { host, previewer } = setup();
    const file = cfb.utils.cfb_new();
    cfb.utils.cfb_add(file, '\u0001Ole10Native', new Uint8Array([255, 255, 255, 255, 2, 0]));
    const bytes = new Uint8Array(cfb.write(file, { type: 'array' }));
    await previewer.preview(await office({ 'broken.bin': bytes }), { name: 'parent.docx' });
    const createUrl = vi.fn((_blob: Blob) => 'blob:raw-attachment');
    vi.stubGlobal('URL', class extends URL { static createObjectURL = createUrl; static revokeObjectURL = vi.fn(); });
    let filename = '';
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
    try {
      click(host, 'broken.bin');
      await vi.waitFor(() => expect(host.querySelector('[role="alert"]')?.textContent).toContain('truncated'));
      const panel = host.querySelector<HTMLElement>('.filens-attachment-panel')!;
      click(panel, 'Download attachment');
      await vi.waitFor(() => expect(clicked).toHaveBeenCalledOnce());
      const blob = createUrl.mock.calls[0][0];
      expect(blob.size).toBe(bytes.length);
      expect(filename).toBe('broken.bin');
      expect(previewer.getState().error).toBeNull();
    } finally { clicked.mockRestore(); previewer.destroy(); vi.unstubAllGlobals(); }
  });
});
