import { describe, expect, it, vi } from 'vitest';
import { PdfRangeRequests } from '../src/range-requests.mjs';

function rangeManager() {
  const requests = [];
  const manager = {
    getBeginChunk: begin => begin,
    getEndChunk: end => end,
    _chunksNeededByRequest: new Map(),
    _promisesByRequest: new Map(),
    _requestsByChunk: new Map(),
    pdfStream: { getRangeReader: () => ({ cancel: vi.fn() }) },
    sendRequest(begin, end, reader, signal) {
      return new Promise((resolve, reject) => requests.push({ begin, end, reader, signal, resolve, reject }));
    }
  };
  function wait(id, chunks) {
    const reject = vi.fn();
    manager._chunksNeededByRequest.set(id, new Set(chunks));
    manager._promisesByRequest.set(id, { reject });
    for (const chunk of chunks) {
      const waiters = manager._requestsByChunk.get(chunk) ?? [];
      waiters.push(id);
      manager._requestsByChunk.set(chunk, waiters);
    }
    return reject;
  }
  return { manager, requests, wait, ranges: new PdfRangeRequests(manager) };
}

describe('PDF range cancellation', () => {
  it('keeps a shared transfer alive and allows a new request before the cancelled one settles', async () => {
    const { manager, requests, wait, ranges } = rangeManager();
    const reason = new Error('Read cancelled');
    const first = wait(1, [8, 9]);
    const sending = ranges.send(8, 10, true);
    const second = wait(2, [9]);

    ranges.removeWaiter(1, reason);
    expect(first).toHaveBeenCalledWith(reason);
    expect(requests[0].reader.cancel).not.toHaveBeenCalled();
    expect(manager._requestsByChunk.get(9)).toEqual([2]);

    ranges.removeWaiter(2, reason);
    expect(second).toHaveBeenCalledWith(reason);
    expect(requests[0].reader.cancel).toHaveBeenCalledOnce();
    expect(requests[0].signal.aborted).toBe(true);
    expect(manager._requestsByChunk.size).toBe(0);
    expect(manager._promisesByRequest.size).toBe(0);
    expect(manager._chunksNeededByRequest.size).toBe(0);

    wait(3, [8, 9]);
    const reopened = ranges.send(8, 10, true);
    requests[0].resolve();
    await sending;
    ranges.removeWaiter(3, reason);
    expect(requests[1].reader.cancel).toHaveBeenCalledOnce();
    requests[1].resolve();
    await reopened;
  });

  it('rejects all readers waiting on a failing transfer and frees its chunks for retry', async () => {
    const { manager, requests, wait, ranges } = rangeManager();
    const error = new Error('Range read failed');
    const first = wait(1, [8, 9]);
    const sending = ranges.send(8, 10, true);
    const second = wait(2, [9, 10]);
    const remaining = ranges.send(10, 11, true);
    requests[0].reject(error);
    await sending;
    expect(first).toHaveBeenCalledWith(error);
    expect(second).toHaveBeenCalledWith(error);
    expect(requests[1].reader.cancel).toHaveBeenCalledWith(error);
    expect(manager._requestsByChunk.size).toBe(0);
    requests[1].resolve();
    await remaining;
  });
});
