import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';

test('health route responds without touching PostgreSQL', async () => {
  const response = await createApp().request('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, service: 'codeflow-api', version: '1.0.0' });
});
