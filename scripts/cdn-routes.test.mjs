import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const { routes } = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
const compressed = routes.filter(route => route.headers?.['Content-Encoding']);

test('precompressed JS respects encoding exclusions, quality values and range requests', () => {
  const choose = (encoding, headers = {}, method = 'GET') => compressed.find(route =>
    route.methods.includes(method) &&
    route.has.every(condition => new RegExp(`^(?:${condition.value})$`).test(encoding)) &&
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
