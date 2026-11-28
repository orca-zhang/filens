// The PDF.js chunk manager coalesces readers of the same source range.
export class PdfRangeRequests {
  flights = new Map();

  constructor(manager) {
    this.manager = manager;
  }

  async send(begin, end, canCancel) {
    const manager = this.manager;
    const first = manager.getBeginChunk(begin), last = manager.getEndChunk(end);
    const controller = new AbortController();
    const flight = { first, last, canCancel, controller, reader: undefined };
    for (let chunk = first; chunk < last; chunk++) this.flights.set(chunk, flight);
    try {
      flight.reader = manager.pdfStream.getRangeReader(begin, end);
      await manager.sendRequest(begin, end, flight.reader, controller.signal);
    } catch (error) {
      if (manager.aborted || controller.signal.aborted) return;
      const waiters = new Set();
      for (let chunk = first; chunk < last; chunk++) {
        for (const id of manager._requestsByChunk.get(chunk) ?? []) waiters.add(id);
        manager._requestsByChunk.delete(chunk);
        this.flights.delete(chunk);
      }
      for (const id of waiters) this.removeWaiter(id, error);
    } finally {
      for (let chunk = first; chunk < last; chunk++) {
        if (this.flights.get(chunk) === flight) this.flights.delete(chunk);
      }
    }
  }

  removeWaiter(id, reason) {
    const manager = this.manager, needed = manager._chunksNeededByRequest.get(id);
    if (!needed) return;
    manager._chunksNeededByRequest.delete(id);
    const capability = manager._promisesByRequest.get(id);
    manager._promisesByRequest.delete(id);
    capability?.reject(reason);
    const candidates = new Set();
    for (const chunk of needed) {
      const waiters = manager._requestsByChunk.get(chunk);
      const index = waiters?.indexOf(id) ?? -1;
      if (index >= 0) waiters.splice(index, 1);
      const flight = this.flights.get(chunk);
      if (flight?.canCancel) candidates.add(flight);
    }
    for (const flight of candidates) {
      const { first, last, controller, reader } = flight;
      let chunk = first;
      for (; chunk < last; chunk++) if (manager._requestsByChunk.get(chunk)?.length) break;
      if (chunk < last) continue;
      for (chunk = first; chunk < last; chunk++) {
        manager._requestsByChunk.delete(chunk);
        this.flights.delete(chunk);
      }
      controller.abort();
      if (!manager.aborted) reader?.cancel(reason);
    }
  }
}
