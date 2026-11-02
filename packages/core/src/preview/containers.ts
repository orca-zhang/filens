import { PreviewPasswordError, previewPasswordErrorCode } from './password';
import type { PreviewContainerContext, PreviewOptions } from './types';

export const PREVIEW_CONTAINER_LIMITS = {
  maxDepth: 8,
  maxEntryBytes: 128 * 1024 * 1024,
  maxExpandedBytes: 512 * 1024 * 1024,
  maxEntries: 20_000
} as const;

export function createPreviewContainerContext(): PreviewContainerContext {
  return { depth: 0, budget: { expandedBytes: 0 } };
}

export function descendPreviewContainer(context: PreviewContainerContext): PreviewContainerContext {
  if (context.depth >= PREVIEW_CONTAINER_LIMITS.maxDepth) throw new Error('The maximum nested preview depth has been reached.');
  return { depth: context.depth + 1, budget: context.budget };
}

export function waitForContainerTask<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return task;
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(new DOMException('Preview cancelled.', 'AbortError')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    void task.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

export async function readPreviewContainerEntry(
  read: () => Promise<Uint8Array>, size: number | undefined,
  context: PreviewContainerContext, signal?: AbortSignal
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const reserved = size ?? 0;
  if (!Number.isSafeInteger(reserved) || reserved < 0 || reserved > PREVIEW_CONTAINER_LIMITS.maxEntryBytes) {
    throw new Error('Attachment exceeds the preview size limit.');
  }
  if (context.budget.expandedBytes + reserved > PREVIEW_CONTAINER_LIMITS.maxExpandedBytes) {
    throw new Error('The total expanded preview size limit has been reached.');
  }
  context.budget.expandedBytes += reserved;
  try {
    const bytes = await waitForContainerTask(read(), signal);
    signal?.throwIfAborted();
    if (bytes.byteLength > PREVIEW_CONTAINER_LIMITS.maxEntryBytes ||
        context.budget.expandedBytes - reserved + bytes.byteLength > PREVIEW_CONTAINER_LIMITS.maxExpandedBytes) {
      throw new Error('The expanded preview size limit has been reached.');
    }
    context.budget.expandedBytes += bytes.byteLength - reserved;
    return bytes;
  } catch (error) {
    context.budget.expandedBytes -= reserved;
    throw error;
  }
}

export async function readWithPreviewPassword<T>(
  read: (password?: string) => Promise<T>, options: Pick<PreviewOptions, 'requestPassword'>,
  name: string, signal?: AbortSignal, initialPassword?: string
): Promise<T> {
  let password = initialPassword, attempt = 0;
  for (;;) {
    signal?.throwIfAborted();
    try { return await waitForContainerTask(read(password), signal); }
    catch (error) {
      const reason = previewPasswordErrorCode(error);
      if (!reason || reason === 'password_cancelled' || !options.requestPassword) throw error;
      const answer = await waitForContainerTask(Promise.resolve(options.requestPassword({ name, reason, attempt: ++attempt, signal })), signal);
      signal?.throwIfAborted();
      if (answer === null) throw new PreviewPasswordError('password_cancelled');
      password = answer;
    }
  }
}
