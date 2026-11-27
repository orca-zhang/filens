import type { SlideComment, SlideCommentAuthor, SlideCommentMessage, SlideCommentTask } from '@filens/core/presentation-support';

type Translate = (message: string) => string;

function authorName(author: SlideCommentAuthor | undefined, translate: Translate): string {
  return author?.name ?? author?.initials ?? translate('Unknown author');
}

function formatDate(value: string): string {
  return value.replace('T', ' ').replace(/Z$/, ' UTC');
}

function appendAttribution(parent: HTMLElement, name: string, created?: string): void {
  const doc = parent.ownerDocument;
  const author = doc.createElement('strong');
  author.dir = 'auto';
  author.textContent = name;
  parent.append(author);
  if (created) {
    const time = doc.createElement('time');
    time.dateTime = created;
    time.textContent = formatDate(created);
    parent.append(time);
  }
}

function detailList(doc: Document, label: string, className: string) {
  const details = doc.createElement('details');
  const summary = doc.createElement('summary');
  summary.textContent = label;
  details.className = className;
  const list = doc.createElement('ol');
  list.className = 'pptxv-comment-list';
  list.setAttribute('role', 'list');
  details.append(summary, list);
  return { details, summary, list };
}

function renderReactions(doc: Document, reactions: NonNullable<SlideCommentMessage['reactions']>, translate: Translate): HTMLElement {
  const container = doc.createElement('div');
  container.className = 'pptxv-comment-reactions';
  for (const reaction of reactions) {
    const label = `${reaction.type} ${reaction.instances.length}`;
    const { details, summary, list } = detailList(doc, label, 'pptxv-comment-detail');
    summary.setAttribute('aria-label', `${translate('Reactions')} · ${label}`);
    for (const instance of reaction.instances) {
      const row = doc.createElement('li');
      row.className = 'pptxv-comment-attribution';
      appendAttribution(row, authorName(instance.author, translate), instance.created);
      list.append(row);
    }
    container.append(details);
  }
  return container;
}

const taskActions = {
  created: 'Task created', assigned: 'Assigned to', unassigned: 'Assignees cleared', title: 'Task title',
  schedule: 'Task schedule', progress: 'Task progress', undo: 'Task change undone', unknown: 'Task updated'
} as const;

function renderTask(item: HTMLElement, task: SlideCommentTask, translate: Translate): void {
  const doc = item.ownerDocument;
  const fields = doc.createElement('dl');
  fields.className = 'pptxv-comment-task';
  const entries: Array<[string, string | undefined]> = [
    ['Assigned to', task.assignedTo?.map(person => authorName(person, translate)).join(', ')],
    ['Start date', task.startDate && formatDate(task.startDate)],
    ['Due date', task.dueDate && formatDate(task.dueDate)],
    ['Task progress', task.complete === undefined ? undefined : `${task.complete}%`]
  ];
  for (const [key, value] of entries) {
    if (!value) continue;
    const label = doc.createElement('dt');
    label.textContent = translate(key);
    const field = doc.createElement('dd');
    field.dir = 'auto';
    field.textContent = value;
    fields.append(label, field);
  }
  if (fields.childElementCount) item.append(fields);
  if (!task.history?.length) return;
  const { details, list } = detailList(doc, translate('Task history'), 'pptxv-comment-detail pptxv-comment-history');
  const byId = new Map(task.history.map(event => [event.id.toLowerCase(), event]));
  for (const event of task.history) {
    const row = doc.createElement('li');
    const header = doc.createElement('div');
    header.className = 'pptxv-comment-attribution';
    appendAttribution(header, authorName(event.author, translate), event.created);
    const action = doc.createElement('div');
    action.dir = 'auto';
    const parts = [translate(taskActions[event.kind])];
    if (event.kind === 'assigned') parts.push(authorName(event.assignee, translate));
    if (event.kind === 'title' && event.title !== undefined) parts.push(event.title || '—');
    if (event.kind === 'progress' && event.complete !== undefined) parts.push(`${event.complete}%`);
    if (event.kind === 'schedule') {
      if (event.startDate) parts.push(`${translate('Start date')} ${formatDate(event.startDate)}`);
      if (event.dueDate) parts.push(`${translate('Due date')} ${formatDate(event.dueDate)}`);
    }
    if (event.kind === 'undo' && event.eventId) {
      const target = byId.get(event.eventId.toLowerCase());
      if (target && target !== event) parts.push(translate(taskActions[target.kind]));
    }
    action.textContent = parts.join(' · ');
    row.append(header, action);
    list.append(row);
  }
  item.append(details);
}

export function renderSlideComments(
  doc: Document, comments: readonly SlideComment[], translate: (message: string) => string,
  locate: (comment: SlideComment) => Array<{
    label: string;
    opensDialog: boolean;
    selected: boolean;
    activate: (button: HTMLButtonElement) => void;
  }>
): HTMLElement {
  const list = doc.createElement('ol');
  list.className = 'pptxv-comment-list';
  list.setAttribute('role', 'list');
  const appendMessage = (parent: HTMLElement, comment: SlideCommentMessage) => {
    const item = doc.createElement('li');
    item.className = 'pptxv-comment';
    const header = doc.createElement('header');
    appendAttribution(header, authorName(comment.author, translate), comment.created);
    if (comment.status === 'resolved' || comment.status === 'closed') {
      const status = doc.createElement('span');
      status.className = 'pptxv-comment-status';
      status.textContent = translate(comment.status === 'resolved' ? 'Resolved' : 'Closed');
      header.append(status);
    }
    item.append(header);
    if (comment.task?.title) {
      const heading = doc.createElement('strong');
      heading.dir = 'auto';
      heading.textContent = comment.task.title;
      item.append(heading);
    }
    if (comment.text) {
      const body = doc.createElement('div');
      body.dir = 'auto';
      body.className = 'pptxv-comment-text';
      body.textContent = comment.text;
      item.append(body);
    }
    if (comment.reactions?.length) item.append(renderReactions(doc, comment.reactions, translate));
    if (comment.task) renderTask(item, comment.task, translate);
    parent.append(item);
    return item;
  };
  for (const comment of comments) {
    const item = appendMessage(list, comment);
    const actions = locate(comment);
    actions.forEach((action, index) => {
      const button = doc.createElement('button');
      button.className = 'pptxv-comment-locate';
      button.type = 'button';
      const label = translate(action.label);
      button.textContent = actions.length === 1 ? label : `${label} (${index + 1})`;
      if (action.opensDialog) button.setAttribute('aria-haspopup', 'dialog');
      else button.setAttribute('aria-pressed', String(action.selected));
      button.addEventListener('click', () => action.activate(button));
      item.append(button);
    });
    if (comment.replies?.length) {
      const replies = doc.createElement('ol');
      replies.className = 'pptxv-comment-list pptxv-comment-replies';
      replies.setAttribute('role', 'list');
      for (const reply of comment.replies) appendMessage(replies, reply);
      item.append(replies);
    }
  }
  return list;
}
