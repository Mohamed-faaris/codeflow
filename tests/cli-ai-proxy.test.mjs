import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCodeflowServer } from '../cli/codeflow.mjs';

test('the local CodeFlow server proxies AI API requests and keeps the token server-side', async () => {
  let received = null;
  const upstream = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = {
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      body: Buffer.concat(chunks).toString('utf8')
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;
  const root = await mkdtemp(path.join(os.tmpdir(), 'codeflow-ai-proxy-'));
  const local = createCodeflowServer({
    uiRoot: root,
    watchRoot: root,
    aiApiUrl: 'http://127.0.0.1:' + upstreamPort,
    aiApiToken: 'server-only-token'
  });
  try {
    await new Promise((resolve) => local.server.listen(0, '127.0.0.1', resolve));
    const port = local.server.address().port;
    const response = await fetch('http://127.0.0.1:' + port + '/api/projects?from=ui', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath: '/tmp/example' })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(received, {
      method: 'POST',
      url: '/api/projects?from=ui',
      authorization: 'Bearer server-only-token',
      body: JSON.stringify({ rootPath: '/tmp/example' })
    });
  } finally {
    await local.close();
    await new Promise((resolve) => upstream.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
