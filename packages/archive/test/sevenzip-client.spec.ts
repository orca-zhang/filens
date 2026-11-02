import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const workers = vi.hoisted(() => [] as any[]);
const moduleLoader = vi.hoisted(() => vi.fn());
vi.mock('../src/sevenzip/module', () => ({ loadArchiveModule: moduleLoader }));
vi.mock('../src/sevenzip/archive-worker.ts?worker', () => ({ default: class {
  onmessage: any; onerror: any; onmessageerror: any;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { workers.push(this); }
} }));
beforeEach(() => { moduleLoader.mockReset(); moduleLoader.mockResolvedValue({ compiled: true }); });

import { runArchiveWorker } from '../src/sevenzip/client';

const request = { bytes: new Uint8Array([0, 255, 1]), format: '7z' as const };
afterEach(() => { workers.splice(0); vi.useRealTimers(); });
describe('archive WASM worker lifetime', () => {
  it('transfers an independent source copy and terminates after returning output', async () => {
    const pending = runArchiveWorker(request);
    const worker = workers[0];
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
    const [message, transfer] = worker.postMessage.mock.calls[0];
    expect(message.wasmModule).toEqual({ compiled: true });
    expect(message.bytes).toEqual(request.bytes);
    expect(message.bytes.buffer).not.toBe(request.bytes.buffer);
    expect(transfer).toEqual([message.bytes.buffer]);
    worker.onmessage({ data: { result: { entries: [] } } });
    await expect(pending).resolves.toEqual({ entries: [] });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it.each(['password_required', 'password_invalid'])('preserves the %s error code across the worker boundary', async code => {
    const pending = runArchiveWorker(request);
    workers[0].onmessage({ data: { error: { code, message: 'decrypt' } } });
    await expect(pending).rejects.toMatchObject({ code });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
  it('terminates a busy worker immediately on cancellation and ignores late output', async () => {
    const controller = new AbortController();
    const pending = runArchiveWorker(request, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    workers[0].onmessage({ data: { result: { entries: [] } } });
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
  it('does not start a worker for an already cancelled request', async () => {
    const controller = new AbortController(); controller.abort();
    expect(() => runArchiveWorker(request, controller.signal)).toThrow();
    expect(workers).toHaveLength(0);
  });
  it('terminates processing at the time limit', async () => {
    vi.useFakeTimers();
    const pending = runArchiveWorker(request);
    const assertion = expect(pending).rejects.toThrow('time limit');
    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
  it('settles startup failures and releases the worker', async () => {
    const pending = runArchiveWorker(request);
    workers[0].onerror(new Error('failed to fetch WASM'));
    await expect(pending).rejects.toThrow('worker');
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
  it('cancels while compilation is pending without transferring source buffers later', async () => {
    let complete!: (value: unknown) => void;
    moduleLoader.mockReturnValueOnce(new Promise(resolve => { complete = resolve; }));
    const controller = new AbortController();
    const pending = runArchiveWorker(request, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    complete({ compiled: true });
    await Promise.resolve();
    expect(workers[0].postMessage).not.toHaveBeenCalled();
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
  it('releases the idle worker when module loading fails', async () => {
    moduleLoader.mockRejectedValueOnce(new Error('network unavailable'));
    await expect(runArchiveWorker(request)).rejects.toThrow('network unavailable');
    expect(workers[0].terminate).toHaveBeenCalledOnce();
  });
  it('uses the external URL fallback if the browser cannot clone compiled modules', async () => {
    const pending = runArchiveWorker(request);
    workers[0].postMessage.mockImplementationOnce(() => { throw new DOMException('unsupported', 'DataCloneError'); });
    await vi.waitFor(() => expect(workers[0].postMessage).toHaveBeenCalledTimes(2));
    const [first, second] = workers[0].postMessage.mock.calls.map((call: any[]) => call[0]);
    expect(first.wasmModule).toBeDefined();
    expect(second.wasmModule).toBeUndefined();
    expect(second.wasmUrl).toEqual(first.wasmUrl);
    expect(second.bytes).toEqual(request.bytes);
    workers[0].onmessage({ data: { result: { entries: [] } } });
    await expect(pending).resolves.toEqual({ entries: [] });
  });
});

it('transfers independent copies of every volume and keeps originals available for retries', async () => {
  const extra = { name: 'b.7z.002', bytes: new Uint8Array([3, 4]) };
  const pending = runArchiveWorker({ ...request, name: 'b.7z.001', volumes: [extra] });
  const worker = workers[0];
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce());
  const [message, transfer] = worker.postMessage.mock.calls[0];
  expect(message.volumes[0]).toEqual(extra);
  expect(message.volumes[0].bytes.buffer).not.toBe(extra.bytes.buffer);
  expect(transfer).toEqual([message.bytes.buffer, message.volumes[0].bytes.buffer]);
  worker.onmessage({ data: { result: { entries: [] } } });
  await expect(pending).resolves.toEqual({ entries: [] });
});
