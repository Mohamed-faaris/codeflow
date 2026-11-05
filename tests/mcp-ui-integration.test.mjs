import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the original CodeFlow UI exposes the MCP server interface', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /function renderMcpWorkspace/);
  assert.match(html, /rightTab==='mcp'&&renderMcpWorkspace\(\)/);
  assert.match(html, /mcpBuildClientConfig/);
  assert.match(html, /mcpCopyText/);
  assert.match(html, /CODEFLOW_ALLOWED_ROOTS/);
  assert.match(html, /apps\/mcp\/src\/index\.js/);
  assert.match(html, /STDIO/);
  for (const tool of [
    'codeflow_analyze_repository',
    'codeflow_search_code',
    'codeflow_get_file_context',
    'codeflow_get_dependency_graph',
    'codeflow_get_blast_radius',
    'codeflow_get_security_findings',
    'codeflow_find_symbol',
    'codeflow_get_file_dependencies'
  ]) assert.ok(html.includes(tool), `missing ${tool}`);
});

test('MCP server registers eight read-only stdio tools', async () => {
  const source = await readFile(new URL('../apps/mcp/src/index.js', import.meta.url), 'utf8');
  const tools = await readFile(new URL('../apps/mcp/src/tools.js', import.meta.url), 'utf8');
  assert.match(source, /serveStdio/);
  assert.match(source, /readOnlyHint:\s*true/);
  assert.equal((source.match(/z\.object\(/g) || []).length, 8);
  for (const name of ['analyze_repository','search_code','get_file_context','get_dependency_graph','get_blast_radius','get_security_findings','find_symbol','get_file_dependencies']) {
    assert.ok(tools.includes(name), `missing MCP handler ${name}`);
  }
});
