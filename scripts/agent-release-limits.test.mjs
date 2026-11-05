import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNativeArchiveLimit, LITE_ARCHIVE_LIMIT } from './agent-release-limits.mjs';

test('Lite archives must stay strictly below 10 MB in decimal bytes', () => {
  assert.equal(LITE_ARCHIVE_LIMIT, 10_000_000);
  const lite = bytes => assertNativeArchiveLimit({ kind: 'cli-lite', bytes, file: 'lite.tar.gz' });
  assert.doesNotThrow(() => lite(9_999_999));
  for (const bytes of [10_000_000, 10_000_001, 10 * 1048576, 0, NaN]) {
    assert.throws(() => lite(bytes), /Lite archive must be smaller than 10000000 bytes/);
  }
  assert.doesNotThrow(() => assertNativeArchiveLimit({ kind: 'cli-full', bytes: 40_000_000, file: 'full.zip' }));
});
