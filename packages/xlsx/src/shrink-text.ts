import { cellTextContext, cellTextFont } from './cell-text-metrics';

export function createShrinkTextFitter(document: Document) {
  const canvas = cellTextContext(document);
  if (!canvas) return undefined;

  return (cell: HTMLTableCellElement, width: number, indent: number, richText: boolean, hasIcon: boolean) => {
    const text = cell.textContent ?? '';
    if (!text || /[\n\r]/.test(text)) return;

    const base = cell.style, fontSize = Number.parseFloat(base.fontSize) || 12;
    const borders = ((Number.parseFloat(base.borderLeftWidth) || 0) + (Number.parseFloat(base.borderRightWidth) || 0)) / 2;
    const available = width - 16 - indent - Math.max(1, borders) - (hasIcon ? 1.3 * fontSize : 0);
    if (available <= 0) return;

    let measured = 0, tallestFont = fontSize;
    const measure = (value: string, style?: CSSStyleDeclaration) => {
      const size = Number.parseFloat(style?.fontSize ?? '') || fontSize;
      tallestFont = Math.max(tallestFont, size);
      canvas.font = cellTextFont(base, size, style);
      const sections = value.split('\t');
      measured += canvas.measureText(sections[0]).width;
      if (sections.length < 2) return;
      const tab = canvas.measureText('        ').width;
      for (const section of sections.slice(1)) {
        if (tab) measured = (Math.floor(measured / tab) + 1) * tab;
        measured += canvas.measureText(section).width;
      }
    };
    if (richText && cell.firstElementChild) {
      for (const run of cell.firstElementChild.children) measure(run.textContent ?? '', (run as HTMLElement).style);
    } else {
      measure(cell.classList.contains('xlsxv-formatted-value') ? text : text.replace(/[\t ]+/g, ' ').replace(/^ | $/g, ''));
    }
    // Canvas and inline layout can round individual advances at different boundaries.
    const required = measured * 1.003;
    if (required <= available || !Number.isFinite(required)) return;
    const scale = available / required;
    const fitted = document.createElement('span');
    fitted.className = 'xlsxv-shrink-text';
    fitted.style.width = `${available}px`;
    fitted.style.height = `calc(${scale * tallestFont / fontSize} * 1lh)`;
    if (base.textAlign === 'right') fitted.style.marginLeft = 'auto';
    else if (base.textAlign === 'center') fitted.style.marginInline = 'auto';
    const glyphs = document.createElement('span');
    // Shape at the saved font size before scaling. Very small CSS fonts can change advances.
    glyphs.style.transform = `scale(${scale})`;
    glyphs.style.textDecorationLine = base.textDecorationLine;
    glyphs.style.textDecorationStyle = base.textDecorationStyle;
    glyphs.append(...cell.childNodes);
    fitted.append(glyphs);
    cell.append(fitted);
    return true;
  };
}
