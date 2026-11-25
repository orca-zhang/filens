import { afterEach, describe, expect, it } from 'vitest';
import { createTextPreviewDriver, resolveFormatRoute } from '../src/preview';
const sessions: Array<{ destroy(): void }> = [];
afterEach(() => { for (const session of sessions.splice(0)) session.destroy(); document.body.replaceChildren(); });
async function open(text: string, name = 'code.ts') {
  const host = document.body.appendChild(document.createElement('div'));
  const session = createTextPreviewDriver().createSession(host); sessions.push(session);
  const source = new TextEncoder().encode(text);
  await session.load(source, { descriptor: { source, name }, route: resolveFormatRoute({ name }) ?? undefined });
  return { host, session };
}

describe('text preview search and wrapping', () => {
  it('finds literal case-insensitive text across code tokens, preserves source, and wraps match navigation', async () => {
    const text = 'const value = "A.b";\r\n// a.B\nconst other = value;';
    const { host, session } = await open(text);
    await session.find?.('A.b');
    expect(session.getState().search).toMatchObject({ total: 2, activeIndex: 0, searching: false, truncated: false });
    expect(host.querySelector('pre')?.textContent).toBe(text);
    expect(host.querySelector('.pptxv-token--string mark')?.textContent).toBe('A.b');
    session.findNext?.(true); expect(session.getState().search?.activeIndex).toBe(1);
    session.findNext?.(); expect(session.getState().search?.activeIndex).toBe(0);
    await session.find?.('const value');
    expect(host.querySelectorAll('mark.is-active')).toHaveLength(2);
    session.setWrap?.(true);
    expect(session.getState()).toMatchObject({ wrap: true, search: { total: 1 } });
    expect(host.querySelector('pre')?.textContent).toBe(text);
    expect(host.querySelectorAll('.pptxv-text-line')).toHaveLength(3);
    expect(host.querySelectorAll('.pptxv-token--keyword')).toHaveLength(2);
    await session.find?.('');
    expect(host.querySelectorAll('mark')).toHaveLength(0);
    expect(host.querySelectorAll('.pptxv-token--keyword')).toHaveLength(2);
    session.setWrap?.(false); expect(host.querySelector('pre')?.textContent).toBe(text);
  });
  it('does not lose or double-count matches crossing a search batch boundary', async () => {
    const text = 'x'.repeat(256 * 1024 - 2) + 'match MATCH';
    const { session } = await open(text);
    await session.find?.('match');
    expect(session.getState().search).toMatchObject({ total: 2, truncated: false });
  });
  it('reports explicit truncation and clears search when the source changes', async () => {
    const { session, host } = await open('a '.repeat(10_001));
    await session.find?.('a');
    expect(session.getState().search).toMatchObject({ total: 10_000, truncated: true, searching: false });
    const source = new TextEncoder().encode('new');
    await session.load(source, { descriptor: { source, name: 'new.txt' } });
    expect(session.getState().search).toMatchObject({ query: '', total: 0, truncated: false });
    expect(host.querySelector('pre')?.textContent).toBe('new');
  });
  it('cancels a yielded search on new queries and destruction without stale state or highlights', async () => {
    const { session, host } = await open('x'.repeat(600_000) + 'needle');
    const old = session.find?.('needle');
    await session.find?.('missing'); await old;
    expect(session.getState().search).toMatchObject({ query: 'missing', total: 0, searching: false });
    const pending = session.find?.('needle'); session.destroy(); await pending;
    expect(host.childElementCount).toBe(0); expect(session.getState().search?.total).toBe(0);
  });
  it('aligns mixed/trailing line endings with logical rows when wrapping and keeps snapshots isolated', async () => {
    const text = 'one\rtwo\r\nthree\n';
    const { session, host } = await open(text, 'notes.txt');
    expect(host.querySelector('pre')?.textContent).toBe(text);
    expect(host.querySelectorAll('.pptxv-text-number')).toHaveLength(4);
    await session.find?.('two');
    const snapshot = session.getState(); snapshot.search!.total = 100;
    expect(session.getState().search?.total).toBe(1);
  });

  it('clears an already displayed source and its pending search when the load signal is aborted', async () => {
    const { session, host } = await open('initial');
    const controller = new AbortController(), source = new TextEncoder().encode('x'.repeat(600_000) + 'needle');
    await session.load(source, { descriptor: { source, name: 'large.ts' }, signal: controller.signal });
    const pending = session.find?.('needle'); controller.abort(); await pending;
    expect(host.querySelector('pre')).toBeNull();
    expect(session.getState()).toMatchObject({ loading: false, search: { total: 0, searching: false } });
  });
});
