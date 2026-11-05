/** A typed search index for a fictional reading room. */
export interface Book {
  id: string;
  title: string;
  author: string;
  tags: readonly string[];
  year: number;
}

interface SearchOptions { query: string; tag?: string; limit?: number; }

const normalize = (value: string): string =>
  value.trim().normalize('NFKC').toLocaleLowerCase();

export function searchBooks(
  books: readonly Book[],
  { query, tag, limit = 12 }: SearchOptions
): Book[] {
  const needle = normalize(query);
  return books
    .filter(book => !tag || book.tags.includes(tag))
    .filter(book =>
      [book.title, book.author, ...book.tags].some(value =>
        normalize(value).includes(needle)
      )
    )
    .sort((a, b) => b.year - a.year || a.title.localeCompare(b.title))
    .slice(0, Math.max(0, limit));
}

export const readingList: readonly Book[] = [
  { id: 'shore-01', title: '沿河散步', author: '林舟', tags: ['城市', '随笔'], year: 2026 },
  { id: 'shore-02', title: '纸上的天气', author: '许青', tags: ['自然', '绘画'], year: 2025 }
];
