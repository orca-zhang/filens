import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import LocalAttachments from '@deepseek-ai/dsh-attachment-local';
import { toolContext } from './helpers.mjs';
import { imageContext, attachImages } from '../src/images.js';
import { makeRequest, renderResult } from '../src/requests.js';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const agent = { options: { provider: 'test', model: 'vision' }, session: { requestHeader: () => undefined } };

test('Office images pass through the real WASM/CLI and DSH attachment pipeline without unpacking', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'filens-dsh-images-'));
  const storeContext = new Context();
  await storeContext.plugin(LocalAttachments, { dshHome: home });
  const { ctx, call } = await toolContext({}, { attachments: storeContext.attachments, llm: { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) } });
  t.after(async () => { await ctx.fiber.dispose(); await storeContext.fiber.dispose(); await rm(home, { recursive: true, force: true }); });
  const input = { path: path.join(repo, 'apps/demo/public/samples/filens-field-notes.pptx'), images: true };
  const result = await call('filens_read', input, { agent });
  assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(result.value.exit_code, 0, JSON.stringify(result.value));
  const c = result.value.response.content;
  assert.equal(c.textScope, 'native-text'); assert.equal(c.complete, true); assert.match(c.text, /CHASE THE LIGHT/);
  assert.deepEqual(c.images.map(v => v.usedBy[0].slide), [1, 2, 3]);
  assert.equal(result.content.filter(v => v.type === 'image').length, 3);
  assert.equal(JSON.stringify(result.value).includes('"data":'), false, 'transport base64 must not enter tool history');
  for (const image of c.images) {
    assert.equal(image.status, 'attached');
    assert.ok(image.attachment.width > 0 && image.attachment.height > 0);
    const { data: bytes } = await storeContext.attachments.readImage(image.attachment, new AbortController().signal);
    assert.ok(bytes.length > 1000, 'durable image bytes must be readable');
  }
  assert.ok(c.media.some(v => v.name.endsWith('image1.png') && v.inspection === 'failed' && v.warning));
  assert.ok(c.warnings.some(v => v.includes('image1.png')));
  const selected = await call('filens_read', { ...input, slides: '2', media: false }, { agent });
  assert.equal(selected.value.exit_code, 0, JSON.stringify(selected));
  assert.equal(selected.content.filter(v => v.type === 'image').length, 1);
  assert.equal(selected.value.response.content.images[0].usedBy[0].slide, 2);
  assert.equal(selected.value.response.content.media, undefined);
  const limited = await call('filens_read', { ...input, max_images: 1 }, { agent });
  assert.equal(limited.value.exit_code, 3);
  assert.equal(limited.value.response.content.imagesInfo.remaining, 2);
  assert.equal(limited.content.filter(v => v.type === 'image').length, 1);
  const bad = await call('filens_read', { ...input, image_names: ['ppt/media/image1.png'] }, { agent });
  assert.equal(bad.value.exit_code, 3); assert.equal(bad.content.filter(v => v.type === 'image').length, 0);
  assert.equal(bad.value.response.content.images[0].status, 'failed');
  assert.match(bad.value.response.error.message, /image1.png/);
  const unknown = await call('filens_read', { ...input, image_names: ['ppt/media/missing.png'] }, { agent });
  assert.equal(unknown.value.exit_code, 2); assert.equal(unknown.value.response.error.code, 'invalid_request');
});

test('image routes and deployment failures are explicit and never leave base64 in model history', async () => {
  const config = { maxBytes: 131072, ocr: true };
  const request = makeRequest('read', { path: 'deck.pptx', images: true }, config);
  assert.equal(request.ocr, 'never'); assert.equal(request.maxImages, 4);
  assert.equal(makeRequest('read', { path: 'deck.pptx', images: true, ocr: 'auto' }, config).ocr, 'auto');
  assert.throws(() => makeRequest('read', { path: 'deck.pptx', max_images: 2 }, config), /images=true/);
  const ctx = { get: key => key === 'attachments' ? {} : { resolveModelInfo: async (provider, model) => ({ inputModalities: model === 'vision' ? ['image'] : ['text'] }) } };
  await imageContext(ctx, { agent, signal: new AbortController().signal });
  await assert.rejects(imageContext(ctx, { agent: { ...agent, session: { requestHeader: () => ({ config: { provider: 'test', model: 'text' } }) } } }), /does not declare image input/);
  const value = { exit_code: 0, response: { ok: true, content: { complete: true, images: [{ name: 'a.png', status: 'ready', mediaType: 'image/png', data: 'eA==' }], imagesInfo: {} } } };
  await attachImages(value, { imageLimits: { mediaTypes: ['image/png'], maxImagesPerMessage: 1, maxImageBytes: 100, maxMessageImageBytes: 100 }, saveImage: async () => { throw new Error('Storage unavailable'); } }, new AbortController().signal);
  assert.equal(value.exit_code, 3); assert.equal(value.response.content.images[0].data, undefined);
  assert.match(renderResult(value, 10000)[0].text, /Storage unavailable/);
  assert.ok(renderResult(value, 10000).every(v => v.type !== 'image'));
});
