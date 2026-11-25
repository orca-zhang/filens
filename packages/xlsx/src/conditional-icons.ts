type Shape = 'arrow' | 'flag' | 'circle' | 'light' | 'diamond' | 'triangle' | 'minus'
  | 'cross' | 'alert' | 'check' | 'bars' | 'pie' | 'star' | 'boxes';

interface IconGraphic {
  shape: Shape;
  color: string;
  label: string;
  rotation?: number;
  level?: number;
  framed?: boolean;
}

const red = '#c23d3d', amber = '#d68b11', green = '#2b834e', gray = '#5f6a7c';
const traffic = [red, amber, green];
const colorNames = ['Red', 'Yellow', 'Green'];
const colors = (shape: Shape, label: string) => traffic.map((color, i): IconGraphic => ({ shape, color, label: `${colorNames[i]} ${label}` }));
const arrowDirections = ['Down', 'Down-right', 'Right', 'Up-right', 'Up'];
const arrows = (indexes: number[], monochrome = false) => indexes.map((index): IconGraphic => ({
  shape: 'arrow', label: `${arrowDirections[index]} arrow`, rotation: 180 - 45 * index,
  color: monochrome ? gray : [red, amber, amber, amber, green][index]
}));
const marks = (framed: boolean) => (['cross', 'alert', 'check'] as const).map((shape, index): IconGraphic => ({
  shape, color: traffic[index], label: ['Red cross', 'Yellow exclamation mark', 'Green check mark'][index], framed
}));
const levels = (shape: Shape, label: string, positions: number[], total: number, color = gray) =>
  positions.map((position): IconGraphic => ({ shape, color, label: `${label} ${position} of ${total}`, level: position / total * 100 }));

export const conditionalIcons = {
  '3Arrows': arrows([0, 2, 4]),
  '3ArrowsGray': arrows([0, 2, 4], true),
  '3Flags': colors('flag', 'flag'),
  '3TrafficLights1': colors('circle', 'traffic light'),
  '3TrafficLights2': colors('light', 'traffic light'),
  '3Signs': [
    { shape: 'diamond', color: red, label: 'Red diamond' },
    { shape: 'triangle', color: amber, label: 'Yellow triangle' },
    { shape: 'circle', color: green, label: 'Green circle' }
  ],
  '3Symbols': marks(true),
  '3Symbols2': marks(false),
  '4Arrows': arrows([0, 1, 3, 4]),
  '4ArrowsGray': arrows([0, 1, 3, 4], true),
  '4RedToBlack': [
    { shape: 'circle', color: '#373f4b', label: 'Dark gray circle' },
    { shape: 'circle', color: '#8c96a4', label: 'Light gray circle' },
    { shape: 'circle', color: '#e07679', label: 'Light red circle' },
    { shape: 'circle', color: '#ab2834', label: 'Dark red circle' }
  ],
  '4Rating': levels('bars', 'Rating', [1, 2, 3, 4], 4),
  '4TrafficLights': [{ shape: 'circle', color: gray, label: 'Gray traffic light' }, ...colors('circle', 'traffic light')],
  '5Arrows': arrows([0, 1, 2, 3, 4]),
  '5ArrowsGray': arrows([0, 1, 2, 3, 4], true),
  '5Rating': levels('bars', 'Rating', [0, 1, 2, 3, 4], 4),
  '5Quarters': levels('pie', 'Filled quarters', [0, 1, 2, 3, 4], 4),
  '3Stars': levels('star', 'Star fill', [0, 1, 2], 2, amber),
  '3Triangles': [
    { shape: 'triangle', color: red, label: 'Down triangle', rotation: 180 },
    { shape: 'minus', color: amber, label: 'Horizontal dash' },
    { shape: 'triangle', color: green, label: 'Up triangle' }
  ],
  '5Boxes': levels('boxes', 'Filled boxes', [0, 1, 2, 3, 4], 4)
} satisfies Record<string, IconGraphic[]>;

export type ConditionalIconSetName = keyof typeof conditionalIcons;

export function isConditionalIconSet(value: unknown): value is ConditionalIconSetName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(conditionalIcons, value);
}

export function createConditionalIcon(document: Document, set: ConditionalIconSetName, index: number): HTMLSpanElement | undefined {
  const graphic: IconGraphic | undefined = conditionalIcons[set]?.[index];
  if (!graphic) return undefined;
  const icon = document.createElement('span');
  icon.className = 'xlsxv-conditional-icon';
  icon.dataset.shape = graphic.shape;
  icon.dataset.iconSet = set;
  icon.dataset.iconIndex = String(index);
  icon.style.color = graphic.color;
  if (graphic.rotation !== undefined) icon.style.setProperty('--xlsxv-icon-angle', `${graphic.rotation}deg`);
  if (graphic.level !== undefined) icon.style.setProperty('--xlsxv-icon-level', `${graphic.level}%`);
  if (graphic.framed) icon.dataset.framed = '';
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', graphic.label);
  icon.lang = 'en';
  return icon;
}
