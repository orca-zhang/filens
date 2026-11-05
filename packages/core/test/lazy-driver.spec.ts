import { describe, expect, it, vi } from 'vitest';
import { createLazyPreviewDriver } from '../src/preview/lazy-driver';
import { createPreviewer } from '../src/preview/previewer';
import type { PreviewDriver, PreviewSession } from '../src/preview/types';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function textDriver(id = 'text') {
  const session: PreviewSession = {
    load: vi.fn(async () => {}), destroy: vi.fn(), setScale: vi.fn(),
    getState: () => ({ family: 'text', loading: false, error: null, warnings: [], capabilities: { zoom: true } }),
    on: () => () => {}
  };
  const driver: PreviewDriver = { id, family: 'text', supports: () => true, createSession: vi.fn(() => session) };
  return { driver, session };
}

describe('lazy preview drivers', () => {
  it('defers imports and shares concurrent loads and the resolved driver', async () => {
    const { driver } = textDriver();
    const pending = deferred<PreviewDriver>();
    const loader = vi.fn(() => pending.promise);
    const lazy = createLazyPreviewDriver('text', 'text', loader);
    expect(lazy.supports('TXT')).toBe(true);
    expect(loader).not.toHaveBeenCalled();
    const a = lazy.loadDriver!(), b = lazy.loadDriver!();
    expect(a).toBe(b);
    pending.resolve(driver);
    expect(await a).toBe(driver);
    expect(await lazy.loadDriver!()).toBe(driver);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('clears a rejected load so another attempt can succeed', async () => {
    const { driver } = textDriver();
    const loader = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(driver);
    const lazy = createLazyPreviewDriver('text', 'text', loader);
    const preview = createPreviewer(document.createElement('div'), { drivers: [lazy] });
    await preview.preview('hello', { name: 'hello.txt' });
    expect(preview.getState().error).toBe('offline');
    await preview.preview('hello', { name: 'hello.txt' });
    expect(preview.getState().error).toBeNull();
    expect(loader).toHaveBeenCalledTimes(2);
    preview.destroy();
  });

  it('does not create a stale session when switching files during an import', async () => {
    const old = textDriver(), next = textDriver('html');
    const pending = deferred<PreviewDriver>();
    const loader = vi.fn(() => pending.promise);
    const preview = createPreviewer(document.createElement('div'), {
      drivers: [createLazyPreviewDriver('text', 'text', loader), next.driver]
    });
    const opening = preview.preview('old', { name: 'old.txt' });
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
    await preview.preview('<p>next</p>', { name: 'next.html' });
    await opening;
    pending.resolve(old.driver);
    await pending.promise;
    expect(old.driver.createSession).not.toHaveBeenCalled();
    expect(next.session.load).toHaveBeenCalledOnce();
    preview.setScale(2);
    expect(next.session.setScale).toHaveBeenCalledWith(2);
    preview.destroy();
  });

  it('settles a destroyed preview while a shared import continues for another tab', async () => {
    const { driver, session } = textDriver();
    const pending = deferred<PreviewDriver>();
    const loader = vi.fn(() => pending.promise);
    const lazy = createLazyPreviewDriver('text', 'text', loader);
    const first = createPreviewer(document.createElement('div'), { drivers: [lazy] });
    const second = createPreviewer(document.createElement('div'), { drivers: [lazy] });
    const a = first.preview('first', { name: 'a.txt' });
    const b = second.preview('second', { name: 'b.txt' });
    await vi.waitFor(() => expect(loader).toHaveBeenCalledOnce());
    first.destroy();
    await a;
    expect(driver.createSession).not.toHaveBeenCalled();
    pending.resolve(driver);
    await b;
    expect(driver.createSession).toHaveBeenCalledOnce();
    expect(session.load).toHaveBeenCalledWith('second', expect.anything());
    second.destroy();
  });

  it('loads the converted output driver instead of the original format', async () => {
    const { driver, session } = textDriver();
    const loader = vi.fn(async () => driver);
    const unused = vi.fn();
    const preview = createPreviewer(document.createElement('div'), {
      drivers: [createLazyPreviewDriver('text', 'text', loader), createLazyPreviewDriver('legacy', 'text', unused)],
      routes: [
        { extensions: ['old'], family: 'text', driverId: 'legacy', targetFormat: 'txt', conversion: { required: true } },
        { extensions: ['txt'], family: 'text', driverId: 'text' }
      ],
      converter: { convert: vi.fn(async () => ({ source: 'converted', format: 'txt' })) }
    });
    await preview.preview('source', { name: 'file.old' });
    expect(unused).not.toHaveBeenCalled();
    expect(loader).toHaveBeenCalledOnce();
    expect(session.load).toHaveBeenCalledWith('converted', expect.anything());
    preview.destroy();
  });
});
