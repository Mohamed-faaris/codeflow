import 'dotenv/config';
import { serve } from '@hono/node-server';
import { closePool } from '@codeflow/database';
import { createApp } from './app.js';

const hostname = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4317);
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(hostname);
if (!loopback && !process.env.CODEFLOW_API_TOKEN) {
  throw new Error('Set CODEFLOW_API_TOKEN before binding the API to a non-loopback address');
}

const server = serve({ fetch: createApp().fetch, hostname, port }, (info) => {
  process.stdout.write('[codeflow-api] listening on http://' + info.address + ':' + info.port + '\n');
});

async function shutdown() {
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
