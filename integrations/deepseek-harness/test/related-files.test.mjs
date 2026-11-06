import assert from 'node:assert/strict';
import test from 'node:test';
import { relatedFiles } from '../src/related-files.js';

const entry = (id, path, origins = []) => ({ id, name: `${id}.pdf`, path, origins });
const question = (sessionId, seq, time = 0) => ({ sessionId, seq, kind: 'question', time });
const answer = (sessionId, seq, questionSeq, time = 0) => ({ sessionId, seq, kind: 'answer', time, question: question(sessionId, questionSeq) });

test('ranks exact messages and questions above directories and sessions, excluding unrelated files and itself', () => {
  const selected = entry('selected', '/project/docs/report.pdf', [question('one', 0), answer('one', 8, 0)]);
  const files = [selected,
    entry('session', '/project/other/session.pdf', [answer('one', 40, 30, 400)]),
    entry('folder', '/project/docs/folder.pdf', [question('two', 20, 300)]),
    entry('question', '/elsewhere/question.pdf', [answer('one', 12, 0, 200)]),
    entry('message', '/project/docs/message.pdf', [answer('one', 8, 0, 100)]),
    entry('unrelated', '/elsewhere/unrelated.pdf', [question('two', 0)]),
  ];
  assert.deepEqual(relatedFiles(selected, files).map(({ entry, reason }) => [entry.id, reason]), [
    ['message', 'message'], ['question', 'question'], ['folder', 'directory'], ['session', 'session'],
  ]);
});

test('question references connect user attachments to later answers without crossing session identities', () => {
  const selected = entry('attachment', undefined, [question('one', 0)]);
  const shared = entry('answer', undefined, [answer('one', 8, 0)]);
  const unrelated = entry('other-session', undefined, [answer('two', 8, 0)]);
  assert.deepEqual(relatedFiles(selected, [shared, unrelated]).map(({ entry, reason }) => [entry.id, reason]), [['answer', 'question']]);
  assert.deepEqual(relatedFiles(entry('unknown', undefined, [{ kind: 'answer' }]), [entry('missing-metadata', undefined, [{ kind: 'answer' }])]), []);
  assert.deepEqual(relatedFiles(undefined, [shared]), []);
});

test('same-level recommendations are recent first, limited to six, without mutating or reading files', () => {
  const selected = entry('selected', undefined, [question('one', 0)]);
  const files = Array.from({ length: 9 }, (_, index) => Object.freeze({
    ...entry(String(index), undefined, [question('one', index + 1, index)]),
    read() { assert.fail('Recommendation must not read document bytes'); },
  }));
  const original = [...files];
  assert.deepEqual(relatedFiles(selected, files).map(({ entry }) => entry.id), ['8', '7', '6', '5', '4', '3']);
  assert.deepEqual(files, original);
  assert.deepEqual(relatedFiles(selected, [files[0], { ...files[0], id: 'a', name: 'a.pdf' }]).map(({ entry }) => entry.id), ['0', 'a']);
});

test('normalizes Windows separators and does not treat filesystem roots or missing paths as shared directories', () => {
  assert.equal(relatedFiles(entry('a', 'C:\\work\\a.pdf'), [entry('b', 'C:/work/b.pdf')])[0].reason, 'directory');
  for (const [one, two] of [['/a.pdf', '/b.pdf'], ['C:/a.pdf', 'C:/b.pdf'], [undefined, undefined], ['a.pdf', 'b.pdf']]) {
    assert.deepEqual(relatedFiles(entry('a', one), [entry('b', two)]), []);
  }
});
