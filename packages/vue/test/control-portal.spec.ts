import { describe, expect, it, vi } from 'vitest';
import { createControlPortal } from '../src/control-portal';

const flush = () => new Promise<void>(resolve => queueMicrotask(resolve));
function fixture() {
  const source = document.createElement('div');
  const target = document.createElement('div');
  const owner = document.createElement('section');
  const button = document.createElement('button');
  button.dataset.previewControls = '';
  owner.append(button); source.append(owner);
  return { source, target, owner, button };
}

describe('driver control portal', () => {
  it('preserves actual nodes, values and handlers and restores them on detach', () => {
    const { source, target, owner, button } = fixture();
    const click = vi.fn(); button.onclick = click;
    const restore = createControlPortal(source, target);
    expect(target.querySelector('button')).toBe(button);
    button.click(); expect(click).toHaveBeenCalledOnce();
    button.disabled = true; expect(target.querySelector('button')?.disabled).toBe(true);
    restore(); expect(owner.firstChild).toBe(button); expect(target.childNodes.length).toBe(0);
  });

  it('retires old controls when a driver replaces its content', async () => {
    const { source, target, owner, button } = fixture();
    const restore = createControlPortal(source, target);
    const next = document.createElement('input'); next.dataset.previewControls = '';
    owner.replaceChildren(next); await flush();
    expect(target.childNodes.length).toBe(1); expect(target.querySelector('input')).toBe(next);
    expect(button.parentNode).toBeNull();
    source.replaceChildren(); await flush(); expect(target.childNodes.length).toBe(0);
    restore();
  });

  it('moves a control group once and keeps child controls in the group', async () => {
    const { source, target, button } = fixture();
    const group = document.createElement('div'); group.dataset.previewControls = '';
    button.replaceWith(group); group.append(button);
    const restore = createControlPortal(source, target); await flush();
    expect(target.querySelector('[data-preview-controls]')).toBe(group); expect(group.firstChild).toBe(button);
    expect(target.childNodes.length).toBe(1); restore();
  });

  it('keeps tabs independent and stops observing after disposal', async () => {
    const a = fixture(), b = fixture();
    const stopA = createControlPortal(a.source, a.target), stopB = createControlPortal(b.source, b.target);
    stopA(); a.owner.append(document.createElement('span')); await flush();
    expect(a.target.childNodes.length).toBe(0); expect(b.target.querySelector('button')).toBe(b.button);
    stopB();
  });

  it('hides retained parent controls while an attachment is open', async () => {
    const { source, target, owner, button } = fixture();
    const restore = createControlPortal(source, target);
    owner.hidden = true; await flush();
    expect(target.firstElementChild?.getAttribute('hidden')).toBe('');
    expect((target.firstElementChild as HTMLElement).style.display).toBe('none');
    button.hidden = true;
    owner.hidden = false; await flush();
    expect((target.firstElementChild as HTMLElement).style.display).toBe('contents');
    expect(button.hidden).toBe(true);
    restore();
  });

});
