import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadArchivePackage: vi.fn(),
  buildParsedDocument: vi.fn()
}));

vi.mock('../src/parser/archive', () => ({
  loadArchivePackage: mocks.loadArchivePackage
}));

vi.mock('../src/parser/semantic', () => ({
  buildParsedDocument: mocks.buildParsedDocument
}));

import { loadIwork } from '../src/parser/load-iwork';

describe('loadIwork source name propagation', () => {
  beforeEach(() => {
    mocks.loadArchivePackage.mockReset();
    mocks.buildParsedDocument.mockReset();
  });

  it('passes basename-derived sourceName into archive loading', async () => {
    mocks.loadArchivePackage.mockResolvedValue({
      archive: {
        type: 'pages',
        records: {},
        references: {
          outgoing: {},
          incoming: {}
        },
        dataEntries: {},
        warnings: []
      },
      media: {},
      zip: {}
    });
    mocks.buildParsedDocument.mockReturnValue({
      kind: 'pages',
      archive: {
        type: 'pages',
        records: {},
        references: {
          outgoing: {},
          incoming: {}
        },
        dataEntries: {},
        warnings: []
      },
      warnings: [],
      title: 'Doc',
      pages: [],
      media: {}
    });

    const url = 'https://example.com/files/Quarterly%20Report.pages?download=1';
    await loadIwork(url);

    expect(mocks.loadArchivePackage).toHaveBeenCalledWith(url, 'pages', {
      sourceName: 'Quarterly Report.pages'
    });
  });

  it('lets explicit sourceName override inferred names', async () => {
    mocks.loadArchivePackage.mockResolvedValue({
      archive: {
        type: 'pages',
        records: {},
        references: {
          outgoing: {},
          incoming: {}
        },
        dataEntries: {},
        warnings: []
      },
      media: {},
      zip: {}
    });
    mocks.buildParsedDocument.mockReturnValue({
      kind: 'pages',
      archive: {
        type: 'pages',
        records: {},
        references: {
          outgoing: {},
          incoming: {}
        },
        dataEntries: {},
        warnings: []
      },
      warnings: [],
      title: 'Doc',
      pages: [],
      media: {}
    });

    const url = 'https://example.com/files/ignored.pages';
    await loadIwork(url, {
      sourceName: 'Custom Name.pages'
    });

    expect(mocks.loadArchivePackage).toHaveBeenLastCalledWith(url, 'pages', {
      sourceName: 'Custom Name.pages'
    });
  });
});
