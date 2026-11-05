import { createHash } from 'node:crypto';

const DEFAULT_CHUNK_LINES = 100;
const DEFAULT_OVERLAP_LINES = 15;

export function hashContent(content) {
  return createHash('sha256').update(String(content)).digest('hex');
}

export function guessLanguage(filePath) {
  const extension = String(filePath).split('.').pop().toLowerCase();
  const languages = {
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', py: 'python', java: 'java', go: 'go',
    rb: 'ruby', php: 'php', rs: 'rust', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp',
    cs: 'csharp', swift: 'swift', kt: 'kotlin', html: 'html', css: 'css',
    scss: 'scss', json: 'json', md: 'markdown', mdx: 'markdown', sql: 'sql',
    sh: 'shell', yml: 'yaml', yaml: 'yaml', toml: 'toml'
  };
  return languages[extension] || extension || 'text';
}

export function chunkSourceFile(filePath, content, options = {}) {
  const chunkLines = Math.max(20, Math.min(Number(options.chunkLines) || DEFAULT_CHUNK_LINES, 250));
  const overlapLines = Math.max(0, Math.min(Number(options.overlapLines) ?? DEFAULT_OVERLAP_LINES, chunkLines - 1));
  const lines = String(content).split(/\r?\n/);
  const chunks = [];
  let start = 0;
  while (start < lines.length) {
    const end = Math.min(lines.length, start + chunkLines);
    const text = lines.slice(start, end).join('\n');
    if (text.trim()) {
      chunks.push({
        path: filePath,
        index: chunks.length,
        startLine: start + 1,
        endLine: end,
        content: text,
        contentHash: hashContent(text),
        tokenEstimate: Math.ceil(text.length / 4)
      });
    }
    if (end >= lines.length) break;
    start = end - overlapLines;
  }
  return chunks;
}
