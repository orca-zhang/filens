import { ParsedWorkbook, ParsedSheet, createXlsxPreviewDriver } from '@filens/xlsx';

export const workbook = null as unknown as ParsedWorkbook;
export const sheet: ParsedSheet | undefined = workbook.sheets[0];

// @ts-expect-error The published factory must retain its function type, never any.
export const probe: symbol = createXlsxPreviewDriver;
