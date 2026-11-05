import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArchivePreviewSession } from '../src';

const hosts: HTMLElement[] = [];
const sessions: ArchivePreviewSession[] = [];

async function open(files: Record<string, string>, options = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const session = new ArchivePreviewSession(host, options);
  sessions.push(session);
  const zip = new JSZip();
  Object.entries(files).forEach(([name, content], index) => {
    zip.file(name, content, { date: new Date(2026, 0, index + 1) });
  });
  const source = await zip.generateAsync({ type: 'uint8array' });
  await session.load(source, { descriptor: { source, name: 'files.zip', extension: 'zip' } });
  return { host, session, source };
}

const names = (host: HTMLElement) => [...host.querySelectorAll('.archivev-name')].map(cell => cell.textContent);
function search(host: HTMLElement, value: string) {
  const input = host.querySelector<HTMLInputElement>('.archivev-search input')!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  return input;
}
function sort(host: HTMLElement, value: string) {
  const select = host.querySelector<HTMLSelectElement>('.archivev-sort')!;
  select.value = value;
  select.dispatchEvent(new Event('change'));
}
const row = (host: HTMLElement, name: string) => [...host.querySelectorAll<HTMLTableRowElement>('.archivev-row')]
  .find(row => row.querySelector('.archivev-name')?.textContent === name)!;
const key = (element: HTMLElement, value: string) => element.dispatchEvent(new KeyboardEvent('keydown', { key: value, cancelable: true }));

afterEach(() => {
  sessions.splice(0).forEach(session => session.destroy());
  hosts.splice(0).forEach(host => host.remove());
});

describe('archive browser controls', () => {
  it('filters names literally without changing the archive state and clears with Escape', async () => {
    const { host, session } = await open({ 'Readme.md': 'Readme', '产品说明.txt': '说明', 'data[1].json': '{}', 'data[2].json': '{}' });
    const input = search(host, ' README ');
    input.focus();
    expect(names(host)).toEqual(['Readme.md']);
    expect(document.activeElement).toBe(input);
    expect(host.querySelector('.archivev-item-count')?.textContent).toBe('1 / 4 items');
    expect(session.getState().entries).toHaveLength(4);
    search(host, '说明');
    expect(names(host)).toEqual(['产品说明.txt']);
    search(host, '[1]');
    expect(names(host)).toEqual(['data[1].json']);
    search(host, 'missing');
    expect(names(host)).toEqual([]);
    expect(host.querySelector<HTMLElement>('.archivev-table')?.hidden).toBe(true);
    expect(host.querySelector('.archivev-empty strong')?.textContent).toBe('No matching files');
    key(input, 'Escape');
    expect(input.value).toBe('');
    expect(names(host)).toHaveLength(4);
    expect(host.querySelector<HTMLElement>('.archivev-empty')?.hidden).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('.archivev-clear-search')?.hidden).toBe(true);
    search(host, 'Read');
    host.querySelector<HTMLButtonElement>('.archivev-clear-search')!.click();
    expect(names(host)).toHaveLength(4);
    expect(document.activeElement).toBe(input);
  });

  it('sorts sizes and dates with folders first and leaves the canonical listing intact', async () => {
    const { host, session } = await open({ 'z-folder/readme.txt': 'x', 'a.txt': 'large text', 'b.txt': 'x', 'c.txt': '12345' });
    const original = session.getState().entries;
    sort(host, 'size');
    expect(names(host)).toEqual(['z-folder/', 'a.txt', 'c.txt', 'b.txt']);
    sort(host, 'modified');
    expect(names(host)).toEqual(['z-folder/', 'c.txt', 'b.txt', 'a.txt']);
    expect(session.getState().entries).toEqual(original);
    search(host, 'folder');
    row(host, 'z-folder/').click();
    expect(session.getState().route).toBe('/z-folder/');
    expect(host.querySelector<HTMLInputElement>('.archivev-search input')?.value).toBe('');
    expect(host.querySelector<HTMLSelectElement>('.archivev-sort')?.value).toBe('modified');
    expect(names(host)).toEqual(['readme.txt']);
  });

  it('restores the filter, scroll position and keyboard focus after an entry preview', async () => {
    const { host } = await open({ 'a.txt': 'First note', 'b.txt': 'Second note' });
    search(host, '.txt');
    sort(host, 'size');
    host.querySelector('.archivev-listing')!.scrollTop = 210;
    row(host, 'b.txt').click();
    await vi.waitFor(() => expect(host.querySelector('.archivev-entry-text')?.textContent).toBe('Second note'));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Back to archive');
    const back = host.querySelector<HTMLButtonElement>('button[aria-label="Back to archive"]')!;
    back.click();
    expect(host.querySelector<HTMLInputElement>('.archivev-search input')?.value).toBe('.txt');
    expect(host.querySelector<HTMLSelectElement>('.archivev-sort')?.value).toBe('size');
    expect(host.querySelector('.archivev-listing')?.scrollTop).toBe(210);
    expect(document.activeElement).toBe(row(host, 'b.txt'));
  });

  it('moves keyboard focus through results and activates folders with Space', async () => {
    const { host, session } = await open({ 'docs/readme.txt': 'Readme', 'a.txt': 'a', 'b.txt': 'b' });
    const input = search(host, '');
    key(input, 'ArrowDown');
    expect(document.activeElement).toBe(row(host, 'docs/'));
    key(row(host, 'docs/'), 'End');
    expect(document.activeElement).toBe(row(host, 'b.txt'));
    key(row(host, 'b.txt'), 'ArrowUp');
    expect(document.activeElement).toBe(row(host, 'a.txt'));
    key(row(host, 'a.txt'), 'ArrowDown');
    expect(document.activeElement).toBe(row(host, 'b.txt'));
    key(row(host, 'b.txt'), 'Home');
    expect(document.activeElement).toBe(row(host, 'docs/'));
    key(row(host, 'docs/'), ' ');
    expect(session.getState().route).toBe('/docs/');
    expect(names(host)).toEqual(['readme.txt']);
  });

  it('keeps filtered order across repeated sorting and stops keyboard focus at result boundaries', async () => {
    const { host, session } = await open({ 'z-folder/x': 'x', 'a.txt': 'xx', 'b.txt': 'x', 'c.txt': 'xx', 'd.md': 'xxxx' });
    const canonical = session.getState().entries;
    sort(host, 'size');
    search(host, '.txt');
    expect(names(host)).toEqual(['a.txt', 'c.txt', 'b.txt']);
    search(host, 'b');
    expect(names(host)).toEqual(['b.txt']);
    key(row(host, 'b.txt'), 'ArrowDown');
    expect(document.activeElement).toBe(row(host, 'b.txt'));
    key(row(host, 'b.txt'), 'ArrowUp');
    expect(document.activeElement).toBe(row(host, 'b.txt'));
    search(host, '.txt');
    sort(host, 'modified');
    expect(names(host)).toEqual(['c.txt', 'b.txt', 'a.txt']);
    search(host, '');
    sort(host, 'name');
    expect(names(host)).toEqual(['z-folder/', 'a.txt', 'b.txt', 'c.txt', 'd.md']);
    expect(session.getState().entries).toEqual(canonical);
  });

  it('ignores detached results and controls after filtering, navigation or replacement', async () => {
    const { host, session, source } = await open({ 'docs/readme.txt': 'Readme', 'a.txt': 'a' });
    const oldFolder = row(host, 'docs/');
    const input = search(host, 'a.txt');
    oldFolder.click();
    key(oldFolder, 'Enter');
    expect(session.getState().route).toBe('/');
    const oldSort = host.querySelector<HTMLSelectElement>('.archivev-sort')!;
    await session.load(source, { descriptor: { source, name: 'new.zip', extension: 'zip' } });
    input.value = 'nothing';
    input.dispatchEvent(new Event('input'));
    oldSort.value = 'size';
    oldSort.dispatchEvent(new Event('change'));
    expect(names(host)).toEqual(['docs/', 'a.txt']);
    expect(host.querySelector<HTMLInputElement>('.archivev-search input')?.value).toBe('');
    expect(host.querySelector<HTMLSelectElement>('.archivev-sort')?.value).toBe('name');
    session.destroy();
    input.dispatchEvent(new Event('input'));
    expect(host.childElementCount).toBe(0);
  });

  it('distinguishes empty folders from a search with no results', async () => {
    const { host } = await open({ 'empty/': '' });
    row(host, 'empty/').click();
    expect(host.querySelector('.archivev-empty strong')?.textContent).toBe('This folder is empty');
    expect(host.querySelector('.archivev-item-count')?.textContent).toBe('0 items');
    search(host, 'missing');
    expect(host.querySelector('.archivev-empty strong')?.textContent).toBe('No matching files');
  });
});
