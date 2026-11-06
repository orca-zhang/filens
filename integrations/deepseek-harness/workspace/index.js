import { applyRuntime, runtime } from 'dsh-filens';
import { WorkspaceAttachments } from './attachment-path.js';

export const name = 'filens-workspace';
export const inject = ['webServer', 'attachments'];
export function apply(ctx) {
  applyRuntime(ctx, runtime.basePath.replace('/_filens/', '/_filens-workspace/'));
  new WorkspaceAttachments(ctx);
}
