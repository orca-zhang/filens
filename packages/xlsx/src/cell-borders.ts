import type { BorderBox } from '@filens/core';
import type { ParsedCellStyle } from './types';

export function cellBorders(style: Pick<ParsedCellStyle, 'borders' | 'rtlBorders'> | undefined, rtl: boolean): BorderBox | undefined {
  return (rtl ? style?.rtlBorders : undefined) ?? style?.borders;
}
