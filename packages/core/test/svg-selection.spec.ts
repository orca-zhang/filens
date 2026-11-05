import { describe, expect, it, vi } from 'vitest';
import { bindPreviewSvgSelection } from '../src/preview/svg-selection';

function fixture() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.innerHTML = '<g class="node" data-id="first"><rect/></g><g class="node" data-id="last"><text>Last</text></g><g class="node" data-id="last"><rect/></g>';
  const onSelect = vi.fn();
  const selection = bindPreviewSvgSelection(svg, { selector: '.node', idAttribute: 'data-id', onSelect });
  const selected = () => [...svg.querySelectorAll('.is-selected')].map(element => element.getAttribute('data-id'));
  return { svg, selection, selected, onSelect };
}

describe('SVG selection', () => {
  it('preserves duplicate and arbitrary IDs, clears unknown IDs, and leaves other nodes untouched', () => {
    const { svg, selection, selected } = fixture();
    selection.select('last');
    expect(selected()).toEqual(['last', 'last']);
    const first = svg.firstElementChild!;
    const mutations = new MutationObserver(() => {});
    mutations.observe(first, { attributes: true });
    selection.select('last');
    selection.select('missing');
    expect(selected()).toEqual([]);
    expect(mutations.takeRecords()).toHaveLength(0);
    mutations.disconnect();
    selection.destroy();

    first.setAttribute('data-id', 'a"[]#\\');
    const unusual = bindPreviewSvgSelection(svg, { selector: '.node', idAttribute: 'data-id', onSelect: () => {} });
    unusual.select('a"[]#\\');
    expect(selected()).toEqual(['a"[]#\\']);
    unusual.select();
    expect(selected()).toEqual([]);
    unusual.destroy();
  });

  it('handles nested shapes and keyboard activation once, including non-bubbling events', () => {
    const { svg, selection, onSelect } = fixture();
    svg.querySelector('rect')!.dispatchEvent(new MouseEvent('click'));
    const text = svg.querySelector('text')!;
    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      text.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    }
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    svg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSelect.mock.calls).toEqual([['first'], ['last'], ['last']]);
    selection.destroy();
    text.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSelect).toHaveBeenCalledTimes(3);
  });
});
