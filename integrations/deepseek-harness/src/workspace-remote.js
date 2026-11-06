import z from 'zod';

// The Workspace Host contributes one metadata-only method. Content still goes
// through DSH's native workspaceFiles endpoint and the frontend WASM core.
export const workspaceRemote = {
  package: '@filens/dsh-workspace',
  descriptors: [{
    id: '@filens/dsh-workspace#filensWorkspace/attachmentPath', namespace: 'filensWorkspace', method: 'attachmentPath',
    service: 'filensWorkspace', invocation: { kind: 'direct' }, cancellation: { parameter: 'signal' },
    parameters: [
      { name: 'sessionId', wire: 'sessionId', source: 'json', codec: { mode: 'strict', typeSymbol: 'string', create: () => z.string().min(1) } },
      { name: 'attachment', wire: 'attachment', source: 'json', codec: { mode: 'strict', typeSymbol: '@filens/dsh-workspace#Attachment', create: () => z.union([
        z.object({ attachmentId: z.string().regex(/^sha256:[a-f0-9]{64}$/), name: z.string().optional(), bytes: z.number().int().nonnegative(), mediaType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']), width: z.number().int().positive(), height: z.number().int().positive() }),
        z.object({ attachmentId: z.string().regex(/^sha256:[a-f0-9]{64}$/), name: z.string().min(1), bytes: z.number().int().nonnegative() }).strict(),
      ]) } },
    ],
    result: { mode: 'strict', typeSymbol: 'string', create: () => z.string() },
  }],
};
