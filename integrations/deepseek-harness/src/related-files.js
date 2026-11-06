const priority = { message: 4, question: 3, directory: 2, session: 1 };
const messageKey = origin => origin?.sessionId && Number.isSafeInteger(origin.seq) ? JSON.stringify([origin.sessionId, origin.seq]) : null;
const questionKey = origin => messageKey(origin.kind === 'question' ? origin : origin.question);
function directoryOf(entry) {
  const path = entry.path?.replace(/\\/g, '/');
  const directory = path?.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
  return directory && !/^[a-z]:$/i.test(directory) ? directory : null;
}

// Recommendations use known references only; no file reads or model calls.
export function relatedFiles(selected, files) {
  if (!selected) return [];
  const messages = new Set(), questions = new Set(), sessions = new Set();
  for (const origin of selected.origins ?? []) {
    if (messageKey(origin)) messages.add(messageKey(origin));
    if (questionKey(origin)) questions.add(questionKey(origin));
    if (origin.sessionId) sessions.add(origin.sessionId);
  }
  const directory = directoryOf(selected);
  return files.filter(entry => entry.id !== selected.id).map(entry => {
    let reason = directory && directoryOf(entry) === directory ? 'directory' : null;
    let time = 0;
    for (const origin of entry.origins ?? []) {
      const match = messages.has(messageKey(origin)) ? 'message' : questions.has(questionKey(origin)) ? 'question'
        : sessions.has(origin.sessionId) ? 'session' : null;
      if (match && (!reason || priority[match] > priority[reason])) reason = match;
      if (Number.isFinite(origin.time)) time = Math.max(time, origin.time);
    }
    return { entry, reason, time };
  }).filter(item => item.reason)
    .sort((a, b) => priority[b.reason] - priority[a.reason] || b.time - a.time || (a.entry.name ?? a.entry.file.name).localeCompare(b.entry.name ?? b.entry.file.name))
    .slice(0, 6);
}
