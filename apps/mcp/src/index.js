import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod/v4';
import { buildToolHandlers, toolDescriptions } from './tools.js';

const schemas = {
  analyze_repository: z.object({
    repositoryPath: z.string().optional(),
    refresh: z.boolean().optional()
  }),
  search_code: z.object({
    repositoryPath: z.string().optional(),
    query: z.string().min(2),
    limit: z.number().int().min(1).max(100).optional(),
    refresh: z.boolean().optional()
  }),
  get_file_context: z.object({
    repositoryPath: z.string().optional(),
    filePath: z.string().min(1),
    startLine: z.number().int().min(1).optional(),
    endLine: z.number().int().min(1).optional()
  }),
  get_dependency_graph: z.object({
    repositoryPath: z.string().optional(),
    filePath: z.string().optional(),
    refresh: z.boolean().optional()
  }),
  get_blast_radius: z.object({
    repositoryPath: z.string().optional(),
    filePath: z.string().min(1),
    refresh: z.boolean().optional()
  }),
  get_security_findings: z.object({
    repositoryPath: z.string().optional(),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info', 'all']).optional(),
    refresh: z.boolean().optional()
  }),
  find_symbol: z.object({
    repositoryPath: z.string().optional(),
    symbolName: z.string().min(1),
    refresh: z.boolean().optional()
  }),
  get_file_dependencies: z.object({
    repositoryPath: z.string().optional(),
    filePath: z.string().min(1),
    refresh: z.boolean().optional()
  })
};

function toToolResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

export function createMcpServer() {
  const server = new McpServer({ name: 'codeflow', version: '1.0.0' });
  const handlers = buildToolHandlers();
  for (const [name, handler] of Object.entries(handlers)) {
    server.registerTool(
      'codeflow_' + name,
      {
        title: 'CodeFlow ' + name.replaceAll('_', ' '),
        description: toolDescriptions[name],
        inputSchema: schemas[name]
      },
      async (args) => {
        try {
          return toToolResult(await handler(args));
        } catch (error) {
          return { ...toToolResult({ error: error.message || 'Tool failed' }), isError: true };
        }
      }
    );
  }
  return server;
}

await serveStdio(() => createMcpServer());
