'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { isSensitiveRepositoryPath, resolveRepositoryRoot, readRepositoryFile } = require('../src/index.cjs');

test('sensitive credential paths are recognized before AI indexing or context reads', () => {
  for (const filePath of [
    '.env',
    '.env.production',
    '.aws/credentials',
    '.ssh/id_ed25519',
    'config/service-account-prod.json',
    'certs/server.pem',
    'infra/terraform.tfstate',
    'private/api-token.txt'
  ]) {
    assert.equal(isSensitiveRepositoryPath(filePath), true, filePath);
  }
  assert.equal(isSensitiveRepositoryPath('src/tokenizer.js'), false);
  assert.equal(isSensitiveRepositoryPath('src/config.example.json'), false);
});

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

test('file reads reject traversal, sensitive paths and symlinks escaping the repository', async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'codeflow-file-'));
  const root = path.join(parent, 'repo');
  const outside = path.join(parent, 'outside.txt');
  await fs.mkdir(path.join(root, '.aws'), { recursive: true });
  await fs.writeFile(path.join(root, 'safe.js'), 'export const safe = true;');
  await fs.writeFile(path.join(root, '.env'), 'OPENAI_API_KEY=do-not-return');
  await fs.writeFile(path.join(root, '.aws', 'credentials'), '[default]');
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
  await assert.rejects(readRepositoryFile(root, '.env'), /Sensitive repository paths/);
  await assert.rejects(readRepositoryFile(root, '.aws/credentials'), /Sensitive repository paths/);
  await assert.rejects(readRepositoryFile(root, 'escape.js'), /symlink escapes/);
  assert.equal((await readRepositoryFile(root, 'safe.js')).content, 'export const safe = true;');
});
