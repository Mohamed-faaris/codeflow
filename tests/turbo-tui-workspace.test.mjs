import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

test('default development command forces the interactive Turborepo TUI', async () => {
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const turbo = JSON.parse(await readFile(new URL('../turbo.json', import.meta.url), 'utf8'));
  assert.match(root.scripts.dev, /--ui=tui/);
  assert.match(root.scripts.dev, /--filter=@codeflow\/api/);
  assert.match(root.scripts.dev, /--filter=@codeflow\/classic-ui/);
  assert.equal(turbo.ui, 'tui');
  assert.equal(turbo.tasks.dev.persistent, true);
  assert.deepEqual(turbo.tasks.dev.passThroughEnv, ['CODEFLOW_WATCH_ROOT']);
});

test('the dashboard is not a pnpm workspace package or a root runtime dependency', async () => {
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const workspace = await readFile(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');
  assert.doesNotMatch(workspace, /apps\/\*/);
  assert.match(workspace, /apps\/api/);
  assert.match(workspace, /apps\/classic-ui/);
  assert.match(workspace, /apps\/mcp/);
  assert.equal(root.scripts['start:dashboard'], undefined);
  await assert.rejects(access(new URL('../apps/dashboard/package.json', import.meta.url)));
});

test('stream mode remains available as the explicit non-TTY alternative', async () => {
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(root.scripts['dev:stream'], /--ui=stream/);
  assert.match(root.scripts['dev:stream'], /--filter=@codeflow\/api/);
  assert.match(root.scripts['dev:stream'], /--filter=@codeflow\/classic-ui/);
});
