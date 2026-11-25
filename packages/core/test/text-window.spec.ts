import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTextPreviewDriver, resolveFormatRoute, type PreviewOptions } from '../src/preview';
const sessions: Array<{ destroy(): void }> = [];
afterEach(() => { for (const session of sessions.splice(0)) session.destroy(); vi.restoreAllMocks(); document.body.replaceChildren(); });
async function open(text: string, name = 'large.ts', options: PreviewOptions = {}) {
  const host = document.body.appendChild(document.createElement('div'));
  const session = createTextPreviewDriver().createSession(host, options); sessions.push(session);
  const source = new TextEncoder().encode(text);
  await session.load(source, { descriptor: { source, name }, route: resolveFormatRoute({ name }) ?? undefined });
  const root = host.querySelector<HTMLElement>('.pptxv-native-preview')!;
  Object.defineProperties(root, { clientHeight: { configurable: true, value: 600 }, clientWidth: { configurable: true, value: 800 } });
  return { host, root, session };
}

describe('virtual text previews', () => {
  it('keeps a bounded source window across 200,000 lines and finds text in the last line', async () => {
    const text = 'const value = 1;\r\n'.repeat(199_999) + 'const last = "needle";';
    const { host, root, session } = await open(text);
    expect(session.getState().lineCount).toBe(200_000);
    expect(host.querySelectorAll('.pptxv-text-line').length).toBeGreaterThan(0);
    expect(host.querySelectorAll('.pptxv-text-line').length).toBeLessThanOrEqual(512);
    expect([...host.querySelectorAll('pre')].map(pre => pre.textContent).join('').length).toBeLessThan(20_000);
    await session.find?.('needle');
    expect(session.getState().search).toMatchObject({ total: 1, activeIndex: 0 });
    expect(host.querySelector('mark.is-active')?.textContent).toBe('needle');
    expect(root.scrollTop).toBeGreaterThan(1_000_000);
    expect([...host.querySelectorAll('.pptxv-text-number')].at(-1)?.textContent).toBe('200000');
    expect(host.querySelectorAll('.pptxv-text-line').length).toBeLessThanOrEqual(512);
  });

  it('copies the entire original source after select-all even though only a window is mounted', async () => {
    const text = 'First\r\n' + '中间\n'.repeat(2000) + 'Last\r';
    const { root, session, host } = await open(text, 'large.txt');
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
    await session.find?.('Last');
    const clipboard = { setData: vi.fn() }, copy = new Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(copy, 'clipboardData', { value: clipboard }); root.dispatchEvent(copy);
    expect(clipboard.setData).toHaveBeenCalledWith('text/plain', text);
    expect(copy.defaultPrevented).toBe(true);
    expect(host.querySelectorAll('.pptxv-text-line').length).toBeLessThanOrEqual(512);
  });

  it('retains multiline syntax state across blocks and uses absolute offsets for search highlights', async () => {
    const text = '/*\n' + 'inside comment\n'.repeat(800) + '*/\nconst needle = true;';
    const { host, session } = await open(text);
    await session.find?.('inside comment'); session.findNext?.(true);
    expect(session.getState().search?.activeIndex).toBe(799);
    expect(host.querySelector('.pptxv-token--comment mark.is-active')?.textContent).toBe('inside comment');
    session.setWrap?.(true);
    expect(host.querySelector('.pptxv-token--comment mark.is-active')?.textContent).toBe('inside comment');
    expect(host.querySelectorAll('.pptxv-text-line').length).toBeLessThanOrEqual(512);
  });

  it('preserves the complete DOM when virtualization is explicitly disabled', async () => {
    const text = 'line\n'.repeat(2000);
    const { host } = await open(text, 'full.ts', { virtual: false });
    expect(host.querySelector('pre')?.textContent).toBe(text);
    expect(host.querySelector('.pptxv-text-window')).toBeNull();
  });

  it('renders an empty final logical line when it starts a new text block', async () => {
    const { host, root } = await open('line\r\n'.repeat(1024));
    root.scrollTop = 1_000_000; root.dispatchEvent(new Event('scroll'));
    await vi.waitFor(() => expect([...host.querySelectorAll('.pptxv-text-number')].at(-1)?.textContent).toBe('1025'));
    expect([...host.querySelectorAll('.pptxv-text-line')].at(-1)?.textContent).toBe('');
    expect(host.querySelectorAll('.pptxv-text-line').length).toBeLessThanOrEqual(512);
  });

  it('cancels pending scrolling when a preview is destroyed', async () => {
    const { root, host, session } = await open('line\n'.repeat(10_000));
    const original = root.innerHTML;
    root.scrollTop = 100_000; root.dispatchEvent(new Event('scroll'));
    session.destroy();
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(host.childElementCount).toBe(0);
    expect(root.innerHTML).toBe('');
    expect(original).toContain('pptxv-text-window');
  });
});
