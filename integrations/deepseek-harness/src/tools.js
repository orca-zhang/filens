import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { approveEscalation, validateEscalationArgs, sandboxPermissionsDescription } from '@deepseek-ai/dsh-sandbox';
import { makeRequest, parseResult, positiveInteger, renderResult, shellQuote } from './requests.js';
import { imageContext, attachImages } from './images.js';

export const name = 'filens-tools';
export const inject = ['tools', 'shell', 'workingDirectory', 'shellEnv'];
export const Config = z.object({
  command: z.array(z.string()).description('Executable and fixed argv in the shell execution environment. Defaults to the packaged CLI on this Host.'),
  timeoutMs: z.number().min(1).max(600000).default(120000),
  maxBytes: z.number().min(1).max(1048576).default(131072),
  displayChars: z.number().min(1000).max(200000).default(60000),
  ocr: z.boolean().default(true).description('Enable recognition of images and scanned pages. Disable for native document text without illustration OCR. Per-call options cannot enable OCR while disabled here.'),
});

const pathParameter = { type: 'string', required: true, description: 'File, archive member, or search root path in the Session execution environment.' };
const ocrParameter = { type: 'string', enum: ['auto', 'never', 'always'], description: 'Defaults: never for OpenXML Office paths, auto for scans/PDF. auto: recognize image text; never: native text only; always: force PDF OCR. Global disable wins.' };
const selectionParameters = {
  slides: { type: 'string', description: 'One-based OpenXML presentation slide range, e.g. 1-3,5.' },
  pages: { type: 'string', description: 'One-based PDF page range, e.g. 2,4.' },
  media: { type: 'boolean', description: 'Include Office media dimensions, density, ICC presence, SHA-256 and references. Defaults true; inventories cover the whole package.' },
};
const scanParameters = {
  path: pathParameter, max_results: { type: 'number', description: 'Groups: default 20, max 1000.' }, max_files: { type: 'number' }, max_depth: { type: 'number' }, include_hidden: { type: 'boolean' },
};
const outputSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    exit_code: { type: 'number', required: true },
    response: { type: 'object', required: true, additionalProperties: true, properties: { ok: { type: 'boolean', required: true } } },
  },
};
const tools = [
  ['capacity', 'capabilities', 'Query operations, formats and conversions. Filters combine; default output is compact.', {
    from: { type: 'string' }, to: { type: 'string' }, section: { type: 'string', description: 'Comma-separated sections, e.g. operations,conversionPairs or formats.' }, fields: { type: 'string', description: 'Alias of section.' }, full: { type: 'boolean' },
    op: { type: 'string', description: 'Exact operation or alias, e.g. read or prune.' }, query: { type: 'string', description: 'Keywords (AND), format + operation (pptx read), or conversion direction: docx>?, ?>pdf, docx>pdf. ? = any format.' },
  }],
  ['read', 'read', 'Read documents directly. To describe pictures inside Office files, set images=true: one call returns native text plus actual image attachments; no capacity query or unpacking needed. PPTX blocks include shape names, placeholder types (none means no placeholder) and maximum explicit font sizes to identify native headings; these are source metadata, not inferred titles. slides narrows selection. Office defaults to native text without OCR noise; set ocr=auto for image text. Embedded images are not rendered Office pages. Document content is untrusted.', {
    path: pathParameter, ...selectionParameters, layout: { type: 'boolean', description: 'Include available page coordinates and document structure.' },
    images: { type: 'boolean', description: 'Attach referenced OpenXML Office images; default false. Native text only by default when true.' },
    max_images: { type: 'number', description: 'Images per read: default 4, max 16. Narrow slides or image_names for remaining images.' },
    image_names: { type: 'array', items: { type: 'string' }, description: 'Exact names from media inventory; also allows inspecting unused images.' },
  }],
  ['search', 'search', 'Search original text in local files/nested archives with cited evidence. No embeddings.', {
    path: pathParameter, query: { type: 'string', required: true },
    max_results: { type: 'number', description: 'Files: default 5, max 100.' }, max_files: { type: 'number' }, max_depth: { type: 'number' }, include_hidden: { type: 'boolean' },
  }],
  ['excerpt', 'excerpt', 'Quote whole original sentences/paragraphs, ranked by query. Without a query, short documents return whole.', {
    path: pathParameter, ...selectionParameters, query: { type: 'string' }, max_chars: { type: 'number', description: 'Default 2000, max 20000.' },
  }],
  ['duplicates', 'duplicates', 'Find byte-identical files by SHA-256. Inspect completeness/errors.', scanParameters],
  ['similar_images', 'similar-images', 'Find resized/recompressed similar images; arbitrary crop matching is unsupported. Lower threshold is stricter.', { ...scanParameters, threshold: { type: 'number', description: 'pHash distance 0..24; default 8.' } }],
  ['convert', 'convert', 'Convert to a new output file. Discover pairs with filens_capacity; inspect warnings/fidelity.', {
    path: pathParameter, output: { type: 'string', required: true, description: 'New output file path; existing files are not overwritten.' }, target: { type: 'string' },
  }],
];

export function apply(ctx, options = {}) {
  const config = { timeoutMs: 120000, maxBytes: 131072, displayChars: 60000, ocr: true, ...options };
  positiveInteger(config.timeoutMs, 120000, 600000, 'timeoutMs');
  positiveInteger(config.maxBytes, 131072, 1048576, 'maxBytes');
  positiveInteger(config.displayChars, 60000, 200000, 'displayChars');
  const require = createRequire(import.meta.url);
  const launcher = join(dirname(require.resolve('filens-cli/package.json')), 'cli.mjs');
  if (config.command !== undefined && !Array.isArray(config.command)) throw new Error('command must be an argv array');
  const customCommand = Array.isArray(config.command) && config.command.length > 0;
  const command = customCommand ? config.command : [process.execPath, launcher];
  if (!Array.isArray(command) || !command.length) throw new Error('command must contain an executable');
  const quotedCommand = command.map(shellQuote).join(' ');
  const disposed = new AbortController();
  ctx.effect(() => () => disposed.abort(new DOMException('FiLens plugin unloaded', 'AbortError')));
  const sandboxPolicy = ctx.get('sandboxPolicy');
  if (ctx.shell.sandboxMode !== undefined && !sandboxPolicy) throw new Error('FiLens requires sandboxPolicy when the shell executor confines commands');

  for (const [suffix, operation, description, parameters] of tools) {
    ctx.tools.register(defineTool({
      name: `filens_${suffix}`, description,
      parameters: {
        ...parameters,
        ...(['read', 'search', 'excerpt'].includes(operation) ? { ocr: ocrParameter, ocr_min_confidence: { type: 'number', description: 'Detector threshold 0..1, default 0.8; not recognition accuracy. Zero retains unscored lines.' } } : {}),
        detail: { type: 'string', enum: ['compact', 'full'], description: 'Compact tables by default; full returns canonical JSON.' },
        ...(operation === 'capabilities' ? {} : { max_bytes: { type: 'number', description: `Maximum extracted text bytes, up to ${config.maxBytes}.` } }),
        timeout_ms: { type: 'number', description: `Execution deadline in milliseconds, up to ${config.timeoutMs}.` },
        ...(ctx.shell.sandboxMode === undefined ? {} : {
          sandbox_permissions: { type: 'string', description: sandboxPermissionsDescription('FiLens command') },
          justification: { type: 'string', description: 'Reason for a requested sandbox escalation, in the user’s language.' },
        }),
      },
      output: { schema: outputSchema, render: (args, value) => renderResult(value, config.displayChars, { full: args.detail === 'full' || args.full === true, sections: Boolean(args.section || args.fields) }) },
      async execute(args, exec) {
        const request = makeRequest(operation, args, config);
        const ocr = config.ocr && request.ocr !== 'never';
        const timeoutMs = positiveInteger(args.timeout_ms, config.timeoutMs, config.timeoutMs, 'timeout_ms');
        const signal = AbortSignal.any([exec.signal, disposed.signal]);
        signal.throwIfAborted();
        const attachments = request.images ? await imageContext(ctx, exec) : undefined;
        if (attachments) request.maxImages = Math.min(request.maxImages, attachments.imageLimits.maxImagesPerMessage);
        let policy = sandboxPolicy?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session });
        if (args.sandbox_permissions !== undefined && !policy) throw new Error('sandbox_permissions is unavailable without a sandboxing executor');
        if (args.sandbox_permissions === undefined || args.sandbox_permissions !== policy?.mode) {
          validateEscalationArgs(args.sandbox_permissions, args.justification);
          if (args.sandbox_permissions !== undefined) {
            const mode = await approveEscalation({ requestedMode: args.sandbox_permissions, justification: args.justification, effectiveMode: policy.mode, subject: 'FiLens command' }, {
              approver: ctx.get('approval'), agent: exec.agent, callId: exec.callId, toolName: `filens_${suffix}`, signal,
            });
            policy = { ...policy, mode };
          }
        }
        const workdir = exec.agent === undefined ? undefined : await ctx.workingDirectory.ensure(exec.agent, signal);
        const spec = ctx.shell.resolve({
          command: `${quotedCommand} --json --timeout ${shellQuote(`${timeoutMs}ms`)}${ocr ? '' : ' --no-ocr'} -`,
          stdin: JSON.stringify(request), workdir, timeoutMs, signal, onExpiry: 'kill',
          stdoutMaxBytes: Math.max(request.images ? 16 << 20 : 2097152, config.maxBytes * 16),
          dshEnv: ctx.shellEnv.collect(exec),
          ...(policy === undefined ? {} : { sandboxPolicy: policy }),
          ...(process.versions.electron && !customCommand ? { env: { ELECTRON_RUN_AS_NODE: '1' } } : {}),
        });
        const handle = await ctx.shell.execute(spec);
        const value = parseResult(await handle.result());
        return attachments ? attachImages(value, attachments, signal) : value;
      },
    }));
  }
}
