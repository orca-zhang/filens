export function columnNameToIndex(name: string): number {
  let index = 0;
  for (const char of name.toUpperCase()) index = index * 26 + char.charCodeAt(0) - 64;
  return index;
}

export function columnIndexToName(index: number): string {
  let name = '';
  while (index > 0) {
    name = String.fromCharCode(65 + (index - 1) % 26) + name;
    index = Math.floor((index - 1) / 26);
  }
  return name || 'A';
}

export function parseCellRef(ref: string): { row: number; column: number } {
  const match = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!match) {
    return {
      row: 1,
      column: 1
    };
  }
  return {
    column: columnNameToIndex(match[1] ?? 'A'),
    row: Number(match[2] ?? 1)
  };
}
