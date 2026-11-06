import styles from './client.css';
import viewerStyles from './viewer.css';
import { FilensBody, FilensActions } from './preview.js';

export { FilensBody, FilensActions, runtimeUrl } from './preview.js';
export const name = 'filens-preview';
export const inject = ['documentPreviews', 'slots'];
const id = 'dsh-filens';

export function apply(ctx) {
  ctx.effect(() => {
    const sheet = document.createElement('style');
    sheet.textContent = styles + viewerStyles;
    document.head.append(sheet);
    return () => sheet.remove();
  });
  ctx.effect(() => ctx.documentPreviews.register({
    id, extensions: __FILENS_EXTENSIONS__, binaryExtensions: __FILENS_BINARY_EXTENSIONS__,
    priority: 'extension', title: () => 'FiLens', loading: 'bytes-complete', wrap: false,
  }));
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document.action', () => ctx.slots.register({ name: 'sidebar.right.tab.document.action', key: id }, FilensActions)));
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({ name: 'sidebar.right.tab.document', key: id }, FilensBody)));
}
