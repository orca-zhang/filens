import type { ParsedCellStyle } from './types';

const images = new WeakMap<NonNullable<ParsedCellStyle['fill']>, string>();
const fullViewBox = encodeURIComponent('viewBox="0 0 1 1"');

export function clipPathGradient(image: string, left: number, top: number, width: number, height: number): string {
  // Keep the image sized to the mounted cell while sampling the full source gradient.
  return image.replace(fullViewBox, encodeURIComponent(`viewBox="${left} ${top} ${width} ${height}"`));
}

export function pathGradientImage(fill: ParsedCellStyle['fill']): string | undefined {
  if (!fill?.pathRectangle || !fill.stops?.length) return undefined;
  const cached = images.get(fill);
  if (cached) return cached;

  const { left, right, top, bottom } = fill.pathRectangle;
  const stops = fill.stops.map(({ position, color }) => `<stop offset="${position}" stop-color="${color}"/>`).join('');
  // Adjacent strips meet at the same stop position along each shared diagonal.
  const strips = [
    { id: 'l', from: [left, 0], to: [0, 0], points: `0,0 ${left},${top} ${left},${bottom} 0,1`, visible: left > 0 },
    { id: 'r', from: [right, 0], to: [1, 0], points: `${right},${top} 1,0 1,1 ${right},${bottom}`, visible: right < 1 },
    { id: 't', from: [0, top], to: [0, 0], points: `0,0 1,0 ${right},${top} ${left},${top}`, visible: top > 0 },
    { id: 'b', from: [0, bottom], to: [0, 1], points: `${left},${bottom} ${right},${bottom} 1,1 0,1`, visible: bottom < 1 }
  ].filter(strip => strip.visible);
  const gradients = strips.map(({ id, from, to }) =>
    `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${from[0]}" y1="${from[1]}" x2="${to[0]}" y2="${to[1]}" href="#stops"/>`).join('');
  const polygons = strips.map(({ id, points }) => `<polygon points="${points}" fill="url(#${id})"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1" preserveAspectRatio="none" shape-rendering="crispEdges">`
    + `<defs><linearGradient id="stops">${stops}</linearGradient>${gradients}</defs>`
    + `<rect width="1" height="1" fill="${fill.stops[0].color}"/>${polygons}</svg>`;
  const image = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  images.set(fill, image);
  return image;
}
