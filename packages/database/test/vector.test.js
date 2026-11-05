import test from 'node:test';
import assert from 'node:assert/strict';
import { vectorLiteral } from '../src/index.js';

test('vectorLiteral serializes finite numeric vectors for pgvector', () => {
  assert.equal(vectorLiteral([0.1, -0.2, 3]), '[0.1,-0.2,3]');
});

test('vectorLiteral rejects empty, oversized and non-finite embeddings', () => {
  assert.throws(() => vectorLiteral([]), /empty/);
  assert.throws(() => vectorLiteral([1, Number.NaN]), /non-finite/);
  assert.throws(() => vectorLiteral(new Array(8193).fill(0)), /dimension limit/);
});
