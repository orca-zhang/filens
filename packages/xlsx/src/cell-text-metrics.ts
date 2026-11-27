export function cellTextContext(document: Document): CanvasRenderingContext2D | null {
  if (/jsdom/i.test(document.defaultView?.navigator.userAgent ?? '')) return null;
  try { return document.createElement('canvas').getContext('2d'); }
  catch { return null; }
}

export function cellTextFont(base: CSSStyleDeclaration, size: number, run?: CSSStyleDeclaration): string {
  return `${run?.fontStyle || base.fontStyle || 'normal'} ${run?.fontWeight || base.fontWeight || '400'} `
    + `${size}px ${run?.fontFamily || base.fontFamily || 'system-ui, sans-serif'}`;
}
