'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { resolveRepositoryRoot, readRepositoryFile } = require('../src/index.cjs');

test('repository roots are constrained by CODEFLOW_ALLOWED_ROOTS', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'codeflow-root-'));
  const allowed = path.join(parent, 'allowed');
  const outside = path.join(parent, 'outside');
  await fs.mkdir(allowed);
  await fs.mkdir(outside);
  const previous = process.env.CODEFLOW_ALLOWED_ROOTS;
  process.env.CODEFLOW_ALLOWED_ROOTS = allowed;
  t.after(async () => {
    if (previous === undefined) delete process.env.CODEFLOW_ALLOWED_ROOTS;
    else process.env.CODEFLOW_ALLOWED_ROOTS = previous;
    await fs.rm(parent, { recursive: true, force: true });
  });
  assert.equal(await resolveRepositoryRoot(allowed), await fs.realpath(allowed));
  await assert.rejects(resolveRepositoryRoot(outside), /outside CODEFLOW_ALLOWED_ROOTS/);
});

test('file reads reject traversal and symlinks escaping the repository', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'codeflow-file-'));
  const root = path.join(parent, 'repo');
  const outside = path.join(parent, 'outside.txt');
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, 'safe.js'), 'export const safe = true;');
  await fs.writeFile(outside, 'secret');
  await fs.symlink(outside, path.join(root, 'escape.js'));
  const previous = process.env.CODEFLOW_ALLOWED_ROOTS;
  process.env.CODEFLOW_ALLOWED_ROOTS = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.CODEFLOW_ALLOWED_ROOTS;
    else process.env.CODEFLOW_ALLOWED_ROOTS = previous;
    await fs.rm(parent, { recursive: true, force: true });
  });
  await assert.rejects(readRepositoryFile(root, '../outside.txt'), /Invalid repository-relative/);
  await assert.rejects(readRepositoryFile(root, 'escape.js'), /symlink escapes/);
});
