import assert from 'node:assert/strict';
import test from 'node:test';
import { WorkspaceAttachments } from '../workspace/attachment-path.js';

test('attachment metadata uses canonical DSH references and rejects unsafe names', () => {
  const reference = { attachmentId: `sha256:${'a'.repeat(64)}`, name: '报告.pdf', bytes: 42 };
  const receiver = { ctx: { attachments: { fileHostPath: ref => { assert.deepEqual(ref, reference); return '/storage/报告.pdf'; } } } };
  const resolve = attachment => WorkspaceAttachments.prototype.attachmentPath.call(receiver, 'session-test', attachment);
  assert.equal(resolve(reference), '/storage/报告.pdf');
  for (const change of [{ attachmentId: 'a'.repeat(64) }, { name: '../报告.pdf' }, { name: 'a\\报告.pdf' }, { name: '.' }, { bytes: -1 }]) {
    assert.throws(() => resolve({ ...reference, ...change }), /Invalid/);
  }
});

test('image attachment paths use the native image store and validate image metadata', () => {
  const ref = { attachmentId: `sha256:${'b'.repeat(64)}`, mediaType: 'image/png', width: 8, height: 6, bytes: 42 };
  const receiver = { ctx: { attachments: { imageHostPath: value => { assert.deepEqual(value, ref); return '/images/sample.png'; } } } };
  const resolve = value => WorkspaceAttachments.prototype.attachmentPath.call(receiver, 'session-test', value);
  assert.equal(resolve(ref), '/images/sample.png');
  for (const change of [{ width: 0 }, { height: -1 }, { mediaType: 'text/plain' }, { name: '../bad.png' }]) {
    assert.throws(() => resolve({ ...ref, ...change }), /Invalid/);
  }
});
