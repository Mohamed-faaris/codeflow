# CodeFlow MCP Server

CodeFlow exposes its existing repository analyzer to external AI agents through a read-only Model Context Protocol (MCP) server over stdio.

## Tools

| Tool | Description |
| --- | --- |
| `codeflow_analyze_repository` | Repository metrics, architecture issues, dependencies and static findings |
| `codeflow_search_code` | Literal source search with file and line references |
| `codeflow_get_file_context` | Bounded source-file context with line numbers |
| `codeflow_get_dependency_graph` | Dependency graph, optionally scoped to a file |
| `codeflow_get_blast_radius` | Transitive impact estimate for a changed file |
| `codeflow_get_security_findings` | Existing static security findings |
| `codeflow_find_symbol` | Find functions by name |
| `codeflow_get_file_dependencies` | Direct dependencies and dependents for a file |

The server is intentionally read-only. It does not expose shell execution, arbitrary file writes, git commits or automatic refactoring. Source text returned by tools must be treated as untrusted input.

## Requirements

- Node.js 20+
- pnpm 10+
- Install the workspace dependencies from the repository root.

## Run

From the CodeFlow repository root:

```bash
pnpm install
CODEFLOW_ALLOWED_ROOTS="$HOME/Projects" pnpm mcp
```

By default, only the current working directory is allowed. Set `CODEFLOW_ALLOWED_ROOTS` to a path-delimited list of directories containing repositories the agent may inspect. This is an explicit filesystem boundary.

## Configure an MCP client

Use the absolute path to your local CodeFlow clone. Example configuration:

```json
{
  "mcpServers": {
    "codeflow": {
      "command": "node",
      "args": ["/absolute/path/to/codeflow/apps/mcp/src/index.js"],
      "env": {
        "CODEFLOW_ALLOWED_ROOTS": "/home/you/Projects"
      }
    }
  }
}
```

Add this server in the custom MCP server settings for Claude Desktop, Claude Code, Cursor, VS Code or another MCP-compatible host. Client configuration locations differ by host.

A tool call can include `repositoryPath` to select a repository within the allowed roots. If omitted, `CODEFLOW_MCP_ROOT` or the process working directory is used.

## Efficiency

Analysis reports are cached per repository for 30 seconds by default. Set `CODEFLOW_MCP_CACHE_TTL_MS` to change the cache lifetime. Pass `refresh: true` to analysis-capable tools to force a fresh scan.

## Data handling and security boundary

- Paths are canonicalized and constrained to configured allowed roots.
- Credential-bearing paths are excluded from analysis results and direct file reads, including `.env*`, private-key files, cloud credential directories, and Terraform state/variable files.
- File reads reject traversal and symlinks that escape the selected repository.
- File context is bounded to 500 lines and 512 KB.
- Source search is literal, not an executable regular expression.
- MCP tools are annotated read-only and do not accept arbitrary commands.
- The MCP host receives source snippets returned by tools. Review the host's data-handling policy before connecting a hosted agent.
- Run the MCP process as an OS user with access only to repositories it should inspect.

The sensitive-path filter reduces accidental credential exposure, but it cannot detect every secret embedded in an ordinary source file.
