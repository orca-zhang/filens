// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IworkWorkerClient } from '../src/worker/client';
import { readWorkerFile } from '../src/worker/file-source';

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  messages: any[] = [];
  terminated = false;
  failPost = false;
  constructor(_url: URL, _options: WorkerOptions) { super(); FakeWorker.instances.push(this); }
  postMessage(message: object, transfer: Transferable[] = []) {
    if (this.failPost) throw new Error('postMessage failed');
    this.messages.push(structuredClone(message, { transfer }));
  }
  terminate() { this.terminated = true; }
  reply(data: object) { this.dispatchEvent(new MessageEvent('message', { data })); }
  fail(message: string) { this.dispatchEvent(Object.assign(new Event('error'), { message })); }
}
const input = () => new Uint8Array([1, 2, 3]);
beforeEach(() => { FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker); });
afterEach(() => vi.unstubAllGlobals());

describe('iWork worker lifecycle', () => {
  it('serves bounded file URL reads through the worker channel and aborts pending reads on replacement', async () => {
    vi.stubGlobal('location', { protocol: 'file:' });
    const held = vi.fn(), abort = vi.fn();
    let pause = false;
    vi.stubGlobal('FileReader', class {
      result?: ArrayBuffer;
      onload?: () => void;
      onerror?: () => void;
      readAsArrayBuffer(blob: Blob) {
        if (pause) { held(blob.size); return; }
        void blob.arrayBuffer().then(result => { this.result = result; this.onload?.(); });
      }
      abort = abort;
    });
    const client = new IworkWorkerClient(), worker = FakeWorker.instances[0];
    const task = client.parse(new Blob([input()]));
    const { source, id } = worker.messages[0];
    try {
      const remote = readWorkerFile(source);
      expect(remote.size).toBe(3);
      expect([...new Uint8Array(await remote.slice(1, 3).arrayBuffer())]).toEqual([2, 3]);
      await expect(remote.slice(0, 4).arrayBuffer()).rejects.toThrow('Could not read');
      worker.reply({ id, document: { kind: 'numbers' } });
      await task;
      expect([...new Uint8Array(await remote.slice(0, 1).arrayBuffer())]).toEqual([1]);

      pause = true;
      const sheet = client.parseSheet(1);
      const cancelled = expect(sheet).rejects.toMatchObject({ name: 'AbortError' });
      source.port.postMessage({ id: 100, start: 1, end: 2 });
      await vi.waitFor(() => expect(held).toHaveBeenCalledWith(1));
      const replacement = client.parse(input());
      await cancelled;
      expect(abort).toHaveBeenCalledOnce();
      expect(worker.terminated).toBe(true);
      const next = FakeWorker.instances[1];
      next.reply({ id: next.messages[0].id, document: { kind: 'pages' } });
      await expect(replacement).resolves.toEqual({ kind: 'pages' });
    } finally { source.port.close(); client.destroy(); }
  });

  it('restores a cached Numbers archive without transferring the viewer buffers', async () => {
    const client = new IworkWorkerClient(), worker = FakeWorker.instances[0];
    const document = { archive: { type: 'numbers', records: {} }, media: { data: new Uint8Array([1, 2]) } } as any;
    const task = client.parseSheet(1, document), request = worker.messages[0];
    expect(request.context).toEqual({ archive: document.archive, media: document.media });
    expect(document.media.data.byteLength).toBe(2);
    const sheetResult = { sheet: { index: 1, loaded: true } };
    worker.reply({ id: request.id, sheetResult });
    await expect(task).resolves.toEqual(sheetResult); client.destroy();
  });
  it('terminates busy parsing immediately and recreates the worker on the next request', async () => {
    const client = new IworkWorkerClient(), first = FakeWorker.instances[0], task = client.parse(input());
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' }); client.cancel(); await rejected;
    expect(first.terminated).toBe(true); const next = client.parse(input()), second = FakeWorker.instances[1];
    first.reply({ id: first.messages[0].id, document: { kind: 'pages' } });
    second.reply({ id: second.messages[0].id, document: { kind: 'key' } }); await expect(next).resolves.toEqual({ kind: 'key' }); client.destroy();
  });
  it('clears an idle archive without discarding the warm worker', async () => {
    const client = new IworkWorkerClient(), worker = FakeWorker.instances[0], task = client.parse(input());
    worker.reply({ id: worker.messages[0].id, document: { kind: 'numbers' } }); await task; client.cancel();
    expect(worker.messages.at(-1)).toEqual({ kind: 'clear' }); expect(worker.terminated).toBe(false);
    const next = client.parse(input()); worker.reply({ id: worker.messages.at(-1).id, document: { kind: 'pages' } }); await next;
    expect(FakeWorker.instances).toHaveLength(1); client.destroy();
  });
  it('rejects old lazy sheets when a new document starts', async () => {
    const client = new IworkWorkerClient(), old = client.parseSheet(1), rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    const current = client.parse(input()); await rejected; const worker = FakeWorker.instances[1];
    worker.reply({ id: worker.messages[0].id, document: { kind: 'pages' } }); await current; client.destroy();
  });
  it('recovers after an actual worker error', async () => {
    const client = new IworkWorkerClient(), old = client.parse(input()), rejected = expect(old).rejects.toThrow('broken worker');
    FakeWorker.instances[0].fail('broken worker'); await rejected;
    const next = client.parse(input()), worker = FakeWorker.instances[1];
    worker.reply({ id: worker.messages[0].id, document: { kind: 'pages' } }); await next; client.destroy();
  });
  it('does not leave orphan requests after synchronous postMessage failures', async () => {
    const client = new IworkWorkerClient(), worker = FakeWorker.instances[0]; worker.failPost = true;
    await expect(client.parse(input())).rejects.toThrow('postMessage failed'); worker.failPost = false; client.cancel();
    expect(worker.terminated).toBe(false); expect(worker.messages).toEqual([{ kind: 'clear' }]); client.destroy();
  });
  it('rejects all requests after destruction instead of leaving them pending', async () => {
    const client = new IworkWorkerClient(); client.destroy(); client.destroy();
    await expect(client.parse(input())).rejects.toThrow('destroyed'); await expect(client.parseSheet(0)).rejects.toThrow('destroyed');
    expect(FakeWorker.instances).toHaveLength(1);
  });
  for (const kind of ['slice', 'shared'] as const) it(`transfers only owned ${kind} bytes`, async () => {
    const client = new IworkWorkerClient(), worker = FakeWorker.instances[0];
    const backing = kind === 'slice' ? new ArrayBuffer(8) : new SharedArrayBuffer(8), original = new Uint8Array(backing);
    original.set([9, 1, 2, 3, 8]); const task = client.parse(original.subarray(1, 4));
    expect([...new Uint8Array(worker.messages[0].source)]).toEqual([1, 2, 3]); expect(original.byteLength).toBe(8);
    worker.reply({ id: worker.messages[0].id, document: { kind: 'pages' } }); await task; client.destroy();
  });
  it('clears a failed idle worker when releasing an archive fails', () => {
    const client = new IworkWorkerClient(), worker = FakeWorker.instances[0]; worker.failPost = true; client.cancel();
    expect(worker.terminated).toBe(true); client.destroy();
  });
});
