import z from 'zod';

// The Workspace Host contributes one metadata-only method. Content still goes
// through DSH's native workspaceFiles endpoint and the frontend WASM core.
export const workspaceRemote = {
  package: 'dsh-filens-workspace',
  descriptors: [{
    id: 'dsh-filens-workspace#filensWorkspace/attachmentPath', namespace: 'filensWorkspace', method: 'attachmentPath',
    service: 'filensWorkspace', invocation: { kind: 'direct' }, cancellation: { parameter: 'signal' },
    parameters: [
      { name: 'sessionId', wire: 'sessionId', source: 'json', codec: { mode: 'strict', typeSymbol: 'string', create: () => z.string().min(1) } },
      { name: 'attachment', wire: 'attachment', source: 'json', codec: { mode: 'strict', typeSymbol: 'dsh-filens-workspace#FileAttachment', create: () => z.object({ attachmentId: z.string().regex(/^sha256:[a-f0-9]{64}$/), name: z.string().min(1), bytes: z.number().int().nonnegative() }) } },
    ],
    result: { mode: 'strict', typeSymbol: 'string', create: () => z.string() },
  }],
};
