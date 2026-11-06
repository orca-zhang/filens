import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';

const initializers = [];
export class WorkspaceAttachments extends TypertRemoteService {
  constructor(ctx) {
    super(ctx, 'filensWorkspace');
    for (const initialize of initializers) initialize.call(this);
  }
  // Resolve storage through DSH, then let its existing file-read endpoint
  // enforce read limits and filesystem permissions. No file bytes are served here.
  attachmentPath(sessionId, attachment, signal) {
    signal?.throwIfAborted();
    if (typeof sessionId !== 'string' || !sessionId || !attachment
      || !/^sha256:[a-f0-9]{64}$/.test(attachment.attachmentId)
      || typeof attachment.name !== 'string' || !attachment.name || /[/\\\0]/.test(attachment.name)
      || ['.', '..'].includes(attachment.name) || !Number.isSafeInteger(attachment.bytes) || attachment.bytes < 0) {
      throw new Error('Invalid DSH file attachment reference');
    }
    const path = this.ctx.attachments.fileHostPath(attachment);
    if (!path) throw new Error('This attachment storage does not expose a filesystem path');
    return path;
  }
}

// Apply the public decorator in plain JS; the package does not require a
// separate TypeScript/decorator toolchain for a single metadata method.
Remote({ resources: { session: sessionId => sessionId } })(WorkspaceAttachments.prototype.attachmentPath, {
  kind: 'method', name: 'attachmentPath', static: false, private: false,
  addInitializer: initialize => initializers.push(initialize),
});
