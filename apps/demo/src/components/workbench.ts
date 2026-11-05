export type WorkbenchFamilyId = 'office' | 'design' | 'media' | 'archive' | 'text';

export interface WorkbenchFormat {
  extension: string;
  family: string;
  label: string;
}

export interface WorkbenchFormatFamily {
  id: WorkbenchFamilyId;
  label: string;
  categories: Array<{ id: string; label: string; formats: WorkbenchFormat[] }>;
}
