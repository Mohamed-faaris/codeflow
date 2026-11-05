import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('AI dashboard contains the three selected workspace modules', async () => {
  const source = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(source, /Chat with your codebase/);
  assert.match(source, /AI Security Auditor/);
  assert.match(source, /AI Refactoring Assistant/);
});

test('dashboard defaults to the local CodeFlow API', async () => {
  const source = await readFile(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(source, /http:\/\/127\.0\.0\.1:4317/);
});
