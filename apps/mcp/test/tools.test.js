import test from 'node:test';
import assert from 'node:assert/strict';
import { affectedFiles } from '../src/tools.js';

test('blast-radius traversal finds transitive dependents without cycles', () => {
  const edges = [
    { source: 'src/db.js', target: 'src/users.js' },
    { source: 'src/users.js', target: 'src/routes.js' },
    { source: 'src/db.js', target: 'src/payments.js' },
    { source: 'src/routes.js', target: 'src/db.js' }
  ];
  assert.deepEqual(affectedFiles(edges, 'src/db.js'), ['src/payments.js', 'src/routes.js', 'src/users.js']);
});

test('blast-radius traversal returns empty array for an unknown file', () => {
  assert.deepEqual(affectedFiles([], 'missing.js'), []);
});
