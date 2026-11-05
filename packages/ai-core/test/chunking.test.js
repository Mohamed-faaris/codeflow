import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkSourceFile, hashContent, guessLanguage } from '../src/chunking.js';
import { parseJsonResponse } from '../src/providers.js';

test('chunkSourceFile preserves line ranges and overlapping context', () => {
  const content = Array.from({ length: 220 }, (_, index) => 'line-' + (index + 1)).join('\n');
  const chunks = chunkSourceFile('src/example.js', content, { chunkLines: 100, overlapLines: 10 });
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].startLine, 1);
  assert.equal(chunks[0].endLine, 100);
  assert.equal(chunks[1].startLine, 91);
  assert.equal(chunks[1].endLine, 190);
  assert.equal(chunks[2].startLine, 181);
  assert.equal(chunks[2].endLine, 220);
});

test('content hashes are stable and language is inferred from extension', () => {
  assert.equal(hashContent('same'), hashContent('same'));
  assert.notEqual(hashContent('same'), hashContent('different'));
  assert.equal(guessLanguage('src/view.tsx'), 'typescript');
});

test('parseJsonResponse accepts plain JSON and fenced JSON', () => {
  assert.deepEqual(parseJsonResponse('{"ok":true}'), { ok: true });
  assert.deepEqual(parseJsonResponse('```json\n{"ok":true}\n```'), { ok: true });
  assert.throws(() => parseJsonResponse('not json'), /valid JSON/);
});
