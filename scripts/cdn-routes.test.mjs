import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const { routes } = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const compressed = routes.filter(route => ['br', 'gzip'].includes(route.headers?.['Content-Encoding']));

test('precompressed JS respects encoding exclusions, quality values and range requests', () => {
  const choose = (encoding, headers = {}, method = 'GET') => compressed.find(route =>
    route.methods.includes(method) &&
    route.has.every(condition => new RegExp(condition.value).test(encoding)) &&
    route.missing.every(condition => !(condition.key in headers)))?.headers['Content-Encoding'];
  for (const [accept, expected] of [
    ['gzip, deflate, br', 'br'], ['gzip', 'gzip'], ['br;q=1.000, gzip', 'br'],
    ['br;q=0, gzip', 'gzip'], ['br;q=0.5, gzip;q=1', 'gzip'],
    ['br;q=0.5, gzip;q=0.8', undefined], ['identity', undefined],
    ['br;q=0, gzip;q=0', undefined], ['xbr', undefined], ['br;q=1.001', undefined], ['', undefined]
  ]) assert.equal(choose(accept), expected, accept);
  assert.equal(choose('br', { range: 'bytes=0-99' }), undefined);
  assert.equal(choose('br', {}, 'POST'), undefined);
  for (const route of compressed) {
    assert.equal(route.headers.Vary, 'Accept-Encoding');
    assert.match(route.headers['Content-Type'], /^application\/javascript/);
    assert.match(route.dest, /filens\.js\.(br|gz)$/);
    assert.match('/cdn/filens-preview@0.3.7/all-in-one/filens.js', new RegExp(`^${route.src}$`));
    assert.doesNotMatch('/cdn/filens-preview@0.3.7/all-in-one/filens.js.br', new RegExp(`^${route.src}$`));
  }
});

test('normalizes disabled codings to identity before platform compression', () => {
  const guard = routes.find(route => route.transforms?.some(transform => transform.target?.key === 'accept-encoding'));
  const matches = value => guard.has.every(condition => new RegExp(condition.value).test(value));
  for (const value of ['br;q=0', 'br;q=0, gzip;q=0', 'identity, br;q=0, gzip;q=0']) assert.ok(matches(value), value);
  for (const value of ['br, gzip', 'br;q=0, gzip', 'br;q=0, gzip;q=0.5', 'br;q=0, identity;q=0']) assert.ok(!matches(value), value);
  assert.equal(guard.transforms[0].args, 'identity');
  assert.equal(guard.headers['Content-Encoding'], 'identity');
  assert.equal(guard.continue, true);
});
