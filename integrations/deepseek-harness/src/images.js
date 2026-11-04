/** DSH attachment plumbing only. The shared WASM core selects/decodes document media. */
export async function imageContext(ctx, exec) {
  const attachments = ctx.get('attachments');
  if (!attachments) throw new Error('images=true requires a DSH attachment store; use images=false for text only.');
  const routed = exec.agent?.session.requestHeader?.()?.config;
  const provider = routed?.provider ?? exec.agent?.options.provider;
  const model = routed?.model ?? exec.agent?.options.model;
  const llm = ctx.get('llm');
  if (!provider || !model || !llm) throw new Error('Cannot resolve the current image model route; use images=false for text only.');
  const active = await llm.resolveModelInfo(provider, model, exec.signal);
  if (!active.inputModalities?.includes('image')) throw new Error(`Model ${model} does not declare image input; use an image-capable model or images=false.`);
  return attachments;
}

export async function attachImages(value, attachments, signal) {
  const content = value.response.content;
  if (!content?.images) return value;
  let total = 0, attached = 0;
  for (let index = 0; index < content.images.length; index++) {
    signal.throwIfAborted();
    const { data, ...image } = content.images[index];
    // Never commit transport base64 to the canonical tool value or the model log.
    content.images[index] = image;
    if (data === undefined) continue;
    try {
      if (typeof data !== 'string' || data.length > (12 << 20)) throw new Error('Invalid image payload size');
      const bytes = Buffer.from(data, 'base64');
      if (!bytes.length || bytes.toString('base64') !== data) throw new Error('Invalid image base64');
      if (!attachments.imageLimits.mediaTypes.includes(image.mediaType)) throw new Error(`Deployment does not accept ${image.mediaType}`);
      if (++attached > Math.min(16, attachments.imageLimits.maxImagesPerMessage)) throw new Error('Image count exceeds deployment limit');
      total += bytes.length;
      if (bytes.length > attachments.imageLimits.maxImageBytes || total > attachments.imageLimits.maxMessageImageBytes) throw new Error('Images exceed deployment byte limits');
      image.attachment = await attachments.saveImage({ data: bytes, mediaType: image.mediaType, name: image.name.split('/').at(-1) });
      signal.throwIfAborted();
      image.status = 'attached';
    } catch (error) {
      signal.throwIfAborted();
      image.status = 'failed';
      image.error = error.message;
      const message = `[media=${image.name}] Image attachment failed: ${error.message}`;
      content.warnings = [...(content.warnings ?? []), message];
      content.complete = false;
      value.response.ok = false;
      value.exit_code = 3;
      value.response.error ??= { code: 'image_unavailable', message };
    }
  }
  if (content.imagesInfo) content.imagesInfo.returned = content.images.filter(v => v.attachment).length;
  return value;
}
