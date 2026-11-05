'use strict';

const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = path.resolve(__dirname, '..', '..', '..');
const ANALYZER_PATH = path.join(PACKAGE_ROOT, 'card', 'analyze.js');
const MAX_ANALYSIS_BYTES = 64 * 1024 * 1024;
const MAX_CONTEXT_LINES = 500;

const SENSITIVE_DIRECTORY_NAMES = new Set([
  '.aws', '.azure', '.docker', '.gnupg', '.kube', '.ssh',
  'credentials', 'secrets'
]);
const SENSITIVE_FILE_NAMES = new Set([
  '.env', '.npmrc', '.pypirc', '.netrc', '.git-credentials',
  '.pgpass', '.htpasswd', 'credentials', 'secrets',
  'terraform.tfstate', 'terraform.tfstate.backup'
]);

function isSensitiveRepositoryPath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath.trim()) return false;
  const segments = relativePath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (!segments.length) return false;

  const lowerSegments = segments.map((segment) => segment.toLowerCase());
  if (lowerSegments.slice(0, -1).some((segment) => SENSITIVE_DIRECTORY_NAMES.has(segment))) {
    return true;
  }

  const filename = lowerSegments[lowerSegments.length - 1];
  if (SENSITIVE_FILE_NAMES.has(filename)) return true;
  if (/^\.env(?:\.|$)/i.test(filename) || /\.env$/i.test(filename)) return true;
  if (/\.(?:pem|key|p12|pfx|jks|keystore|kdb|ppk|asc|gpg|pgp)$/i.test(filename)) return true;
  if (/\.tfvars(?:\.json)?$/i.test(filename)) return true;
  if (/^terraform\.tfstate(?:\.|$)/i.test(filename)) return true;
  if (/^(?:id_rsa|id_ed25519|id_ecdsa|id_dsa)$/i.test(filename)) return true;
  if (/(^|[-_.])(secret|secrets|credential|credentials|token|tokens|private[_-]?key)([-_.]|$)/i.test(filename)) {
    return true;
  }
  if (/(?:service[-_]?account|firebase-adminsdk).*\\.json$/i.test(filename)) return true;
  return false;
}

function configuredRoots() {
  const raw = process.env.CODEFLOW_ALLOWED_ROOTS;
  if (!raw) return [process.cwd()];
  return raw.split(path.delimiter).map((item) => item.trim()).filter(Boolean);
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

async function resolveRepositoryRoot(repositoryPath) {
  if (!repositoryPath || typeof repositoryPath !== 'string') {
    throw new Error('repositoryPath is required');
  }
  const candidate = await fs.realpath(path.resolve(repositoryPath));
  const roots = await Promise.all(configuredRoots().map((root) => fs.realpath(path.resolve(root)).catch(() => null)));
  const allowed = roots.some((root) => root && isInside(root, candidate));
  if (!allowed) {
    throw new Error('Repository path is outside CODEFLOW_ALLOWED_ROOTS');
  }
  const stat = await fs.stat(candidate);
  if (!stat.isDirectory()) throw new Error('Repository path must be a directory');
  return candidate;
}

function normalizeAnalysis(result) {
  if (!result || result.schemaVersion !== 1 || !result.data || !Array.isArray(result.data.files)) {
    throw new Error('CodeFlow analyzer returned an unsupported report');
  }
  return result;
}

function filterSensitiveAnalysis(report) {
  const sensitivePaths = new Set(
    report.data.files
      .filter((file) => file?.path && isSensitiveRepositoryPath(file.path))
      .map((file) => file.path)
  );
  if (!sensitivePaths.size) return report;

  const visible = (item) => ![item?.path, item?.file, item?.filePath, item?.file_path, item?.sourcePath].some((candidate) => candidate && sensitivePaths.has(candidate));
  const data = { ...report.data };
  data.files = data.files.filter(visible);
  if (Array.isArray(data.functions)) data.functions = data.functions.filter(visible);
  if (Array.isArray(data.issues)) data.issues = data.issues.filter(visible);
  if (Array.isArray(data.securityIssues)) data.securityIssues = data.securityIssues.filter(visible);
  if (Array.isArray(data.connections)) {
    data.connections = data.connections.filter((edge) =>
      !sensitivePaths.has(edge?.source || '') && !sensitivePaths.has(edge?.target || '')
    );
  }
  return { ...report, data };
}

async function analyzeRepository(repositoryPath, options = {}) {
  const root = await resolveRepositoryRoot(repositoryPath);
  const timeout = Math.min(Math.max(Number(options.timeoutMs) || 120000, 1000), 300000);
  const args = [ANALYZER_PATH, '--path', root];
  for (const pattern of options.exclude || []) args.push('--exclude', String(pattern));
  const { stdout } = await execFileAsync(process.execPath, args, {
    cwd: PACKAGE_ROOT,
    timeout,
    maxBuffer: MAX_ANALYSIS_BYTES,
    windowsHide: true,
    env: { ...process.env, NO_COLOR: '1' }
  });
  const report = filterSensitiveAnalysis(normalizeAnalysis(JSON.parse(stdout)));
  return { root, report };
}

async function readRepositoryFile(repositoryPath, relativePath, options = {}) {
  const root = await resolveRepositoryRoot(repositoryPath);
  if (typeof relativePath !== 'string' || !relativePath.trim()) throw new Error('filePath is required');
  const normalized = relativePath.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error('Invalid repository-relative file path');
  }
  if (isSensitiveRepositoryPath(normalized)) {
    throw new Error('Sensitive repository paths are not exposed to AI services');
  }
  const candidate = path.resolve(root, normalized);
  if (!isInside(root, candidate)) throw new Error('File path escapes repository root');
  const realFile = await fs.realpath(candidate);
  if (!isInside(root, realFile)) throw new Error('File symlink escapes repository root');
  const stat = await fs.stat(realFile);
  if (!stat.isFile()) throw new Error('Requested path is not a file');
  const maxBytes = Math.min(Number(options.maxBytes) || 512 * 1024, 2 * 1024 * 1024);
  if (stat.size > maxBytes) throw new Error('File exceeds the context size limit');
  const content = await fs.readFile(realFile, 'utf8');
  if (content.includes('\u0000')) throw new Error('Binary files are not supported');
  return { root, path: normalized, content, size: stat.size };
}

async function getFileContext(repositoryPath, filePath, options = {}) {
  const file = await readRepositoryFile(repositoryPath, filePath, options);
  const lines = file.content.split(/\r?\n/);
  const startLine = Math.max(1, Number(options.startLine) || 1);
  const endLine = Math.min(lines.length, Number(options.endLine) || Math.min(lines.length, startLine + 199), startLine + MAX_CONTEXT_LINES - 1);
  if (endLine < startLine) throw new Error('endLine must be greater than or equal to startLine');
  return {
    path: file.path,
    totalLines: lines.length,
    startLine,
    endLine,
    content: lines.slice(startLine - 1, endLine).map((line, index) => String(startLine + index).padStart(5, ' ') + ' | ' + line).join('\n')
  };
}

async function searchCode(repositoryPath, query, options = {}) {
  if (typeof query !== 'string' || query.trim().length < 2) throw new Error('query must contain at least two characters');
  const { root, report } = await analyzeRepository(repositoryPath);
  const limit = Math.min(Math.max(Number(options.limit) || 30, 1), 100);
  const needle = query.toLocaleLowerCase();
  const results = [];
  for (const item of report.data.files) {
    if (results.length >= limit) break;
    if (!item || !item.path || item.analysisSkipped) continue;
    let file;
    try { file = await readRepositoryFile(root, item.path, { maxBytes: 2 * 1024 * 1024 }); } catch { continue; }
    const lines = file.content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      if (lines[index].toLocaleLowerCase().includes(needle)) {
        results.push({ path: item.path, line: index + 1, excerpt: lines[index].trim().slice(0, 500) });
        if (results.length >= limit) break;
      }
    }
  }
  return { query, count: results.length, results };
}

function dependencyEdges(report) {
  const edges = report.data.connections || [];
  return edges.filter((edge) => edge && typeof edge.source === 'string' && typeof edge.target === 'string');
}

async function getDependencyGraph(repositoryPath, filePath) {
  const { report } = await analyzeRepository(repositoryPath);
  const edges = dependencyEdges(report);
  const filtered = filePath
    ? edges.filter((edge) => edge.source === filePath || edge.target === filePath)
    : edges;
  return {
    totalEdges: edges.length,
    edges: filtered.slice(0, 2000).map((edge) => ({
      source: edge.source,
      target: edge.target,
      type: edge.type || 'dependency'
    }))
  };
}

async function getBlastRadius(repositoryPath, filePath) {
  const { report } = await analyzeRepository(repositoryPath);
  const edges = dependencyEdges(report);
  const adjacency = new Map();
  for (const edge of edges) {
    if (!adjacency.has(edge.source)) adjacency.set(edge.source, []);
    adjacency.get(edge.source).push(edge.target);
  }
  const visited = new Set([filePath]);
  const queue = [filePath];
  while (queue.length) {
    const current = queue.shift();
    for (const dependent of adjacency.get(current) || []) {
      if (visited.has(dependent)) continue;
      visited.add(dependent);
      queue.push(dependent);
    }
  }
  visited.delete(filePath);
  return {
    file: filePath,
    affectedCount: visited.size,
    affectedFiles: [...visited].sort(),
    note: 'Impact is inferred from CodeFlow dependency edges; dynamic/runtime references may be missing.'
  };
}

async function getSecurityFindings(repositoryPath, options = {}) {
  const { report } = await analyzeRepository(repositoryPath);
  const findings = report.data.securityIssues || [];
  const severity = options.severity ? String(options.severity).toLowerCase() : null;
  const filtered = findings.filter((finding) => {
    if (!severity || severity === 'all') return true;
    return String(finding.severity || finding.type || '').toLowerCase() === severity;
  });
  return { count: filtered.length, findings: filtered.slice(0, 200) };
}

async function getSymbolContext(repositoryPath, symbolName) {
  if (typeof symbolName !== 'string' || !symbolName.trim()) throw new Error('symbolName is required');
  const { report } = await analyzeRepository(repositoryPath);
  const symbols = (report.data.functions || []).filter((fn) =>
    String(fn.name || '').toLowerCase().includes(symbolName.toLowerCase())
  );
  return {
    query: symbolName,
    count: symbols.length,
    symbols: symbols.slice(0, 100).map((fn) => ({
      name: fn.name,
      file: fn.file || fn.path,
      line: fn.line,
      lines: fn.lines,
      type: fn.type,
      isExported: fn.isExported,
      callers: fn.callers || [],
      code: fn.code ? String(fn.code).slice(0, 12000) : undefined
    }))
  };
}

exports.analyzeRepository = analyzeRepository;
exports.getBlastRadius = getBlastRadius;
exports.getDependencyGraph = getDependencyGraph;
exports.getFileContext = getFileContext;
exports.getSecurityFindings = getSecurityFindings;
exports.getSymbolContext = getSymbolContext;
exports.filterSensitiveAnalysis = filterSensitiveAnalysis;
exports.isSensitiveRepositoryPath = isSensitiveRepositoryPath;
exports.readRepositoryFile = readRepositoryFile;
exports.resolveRepositoryRoot = resolveRepositoryRoot;
exports.searchCode = searchCode;
