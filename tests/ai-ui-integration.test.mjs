import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the original CodeFlow UI contains the integrated AI workspace', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /rightTab==='ai'&&renderAIWorkspace\(\)/);
  assert.match(html, /async function aiSendChat/);
  assert.match(html, /async function aiRunSecurityAudit/);
  assert.match(html, /async function aiCreateRefactorProposal/);
  assert.match(html, /async function aiApproveProposal/);
  assert.match(html, /async function aiApplyProposal/);
  assert.match(html, /aiAutoIndexedRootRef/);
  assert.doesNotMatch(html, /Connect & Index Local Repo/);
  assert.doesNotMatch(html, /Not connected/);
  assert.doesNotMatch(html, /aiApiToken|aiApiBase/);
  assert.match(html, /fetch\(path,Object\.assign/);
  assert.match(html, /\/api\/chat/);
  assert.match(html, /\/api\/security\/audit/);
  assert.match(html, /\/api\/refactoring\/proposals/);
});

test('pnpm dev starts the original UI and API under the Turbo TUI', async () => {
  const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const turbo = JSON.parse(await readFile(new URL('../turbo.json', import.meta.url), 'utf8'));
  assert.match(root.scripts.dev, /--filter=@codeflow\/api/);
  assert.match(root.scripts.dev, /--filter=@codeflow\/classic-ui/);
  assert.equal(turbo.ui, 'tui');
});
