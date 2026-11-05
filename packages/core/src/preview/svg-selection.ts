/** Share SVG input handlers and update only the previous and next selection. */
export function bindPreviewSvgSelection(root: SVGElement, options: {
  selector: string;
  idAttribute: string;
  onSelect: (id: string) => void;
}) {
  const elements = new Map<string, SVGElement[]>();
  for (const element of root.querySelectorAll<SVGElement>(options.selector)) {
    const id = element.getAttribute(options.idAttribute);
    if (id === null) continue;
    const matches = elements.get(id);
    if (matches) matches.push(element);
    else elements.set(id, [element]);
  }
  let selected: SVGElement[] = [];
  const targetId = (event: Event): string | undefined => {
    if (!(event.target instanceof Element)) return undefined;
    const element = event.target.closest<SVGElement>(options.selector);
    if (!element || !root.contains(element)) return undefined;
    const id = element.getAttribute(options.idAttribute);
    return id !== null && elements.get(id)?.includes(element) ? id : undefined;
  };
  const click = (event: Event): void => {
    const id = targetId(event);
    if (id !== undefined) options.onSelect(id);
  };
  const keydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const id = targetId(event);
    if (id === undefined) return;
    event.preventDefault();
    options.onSelect(id);
  };
  // Capture also handles synthetic events that do not bubble.
  root.addEventListener('click', click, true);
  root.addEventListener('keydown', keydown, true);
  return {
    select(id?: string): void {
      const next = id === undefined ? [] : elements.get(id) ?? [];
      if (selected === next) return;
      for (const element of selected) element.classList.remove('is-selected');
      for (const element of next) element.classList.add('is-selected');
      selected = next;
    },
    destroy(): void {
      root.removeEventListener('click', click, true);
      root.removeEventListener('keydown', keydown, true);
      selected = [];
      elements.clear();
    }
  };
}
