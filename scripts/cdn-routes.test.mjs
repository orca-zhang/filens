import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const { routes } = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));

test('obsolete preview CDN paths are gone before Vercel static file lookup', () => {
  const blocked = routes.filter(route => route.src === '/cdn' || route.src === '/cdn/(.*)');
  assert.equal(blocked.length, 2);
  assert.ok(blocked.every(route => route.status === 410));
  assert.ok(blocked.every(route => route.dest === undefined && route.continue === undefined));
  const filesystem = routes.findIndex(route => route.handle === 'filesystem');
  assert.ok(blocked.every(route => routes.indexOf(route) < filesystem));
});

test('legacy versioned download URLs redirect to GitHub Release assets', () => {
  const releasePage = routes.find(item => item.src === '/downloads/(v[^/]+)/?');
  assert.equal(releasePage.status, 308);
  assert.equal(releasePage.dest, 'https://github.com/orca-zhang/filens/releases/tag/$1');

  const route = routes.find(item => item.src === '/downloads/(v[^/]+)/(.*)');
  assert.equal(route.status, 308);
  assert.equal(route.dest, 'https://github.com/orca-zhang/filens/releases/download/$1/$2');
  assert.equal(route.continue, undefined);
});
