import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { analyzeRepository, resolveRepositoryRoot } from '@codeflow/repo-analysis';
import { getPool, transaction, vectorLiteral } from '@codeflow/database';
import { createProviderManager } from './providers.js';
import { chunkSourceFile, guessLanguage, hashContent } from './chunking.js';

const execFileAsync = promisify(execFile);

async function currentCommit(root) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 5000 });
    return stdout.trim();
  } catch {
    return 'working-tree-' + createHash('sha256').update(root).digest('hex').slice(0, 16);
  }
}

export async function indexRepository(options) {
  const root = await resolveRepositoryRoot(options.rootPath);
  const { report } = await analyzeRepository(root, { exclude: options.exclude || [] });
  const providerManager = options.providerManager || createProviderManager();
  const embeddingProvider = options.embeddingProvider || process.env.EMBEDDING_PROVIDER || 'openai';
  let embeddingReady = false;
  let embeddingModel = null;
  try {
    const provider = providerManager.list().find((item) => item.id === embeddingProvider);
    embeddingReady = Boolean(provider && provider.configured && provider.capabilities.embeddings);
    if (embeddingReady) embeddingModel = provider.embeddingModel;
  } catch { embeddingReady = false; }

  const commitSha = options.commitSha || await currentCommit(root);
  const pool = getPool();
  const projectResult = await pool.query(
    `INSERT INTO projects(name, root_path, remote_url, default_branch)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT(root_path) DO UPDATE SET name = EXCLUDED.name, remote_url = COALESCE(EXCLUDED.remote_url, projects.remote_url), updated_at = now()
     RETURNING *`,
    [options.name || path.basename(root), root, options.remoteUrl || null, options.defaultBranch || null]
  );
  const project = projectResult.rows[0];

  const result = await transaction(async (client) => {
    const revisionResult = await client.query(
      `INSERT INTO repository_revisions(project_id, commit_sha, analyzer_schema_version, stats)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT(project_id, commit_sha) DO UPDATE SET stats = EXCLUDED.stats, indexed_at = now()
       RETURNING *`,
      [project.id, commitSha, report.schemaVersion, JSON.stringify(report.data.stats || {})]
    );
    const revision = revisionResult.rows[0];
    await client.query('DELETE FROM dependency_edges WHERE revision_id = $1', [revision.id]);
    const existingResult = await client.query(
      'SELECT id, path, content_hash FROM source_files WHERE revision_id = $1',
      [revision.id]
    );
    const existingFiles = new Map(existingResult.rows.map((row) => [row.path, row]));

    const fileIds = new Map();
    const activePaths = [];
    const reusedFilePaths = new Set();
    let indexedFiles = 0;
    let reusedFiles = 0;
    let indexedChunks = 0;
    let indexedSymbols = 0;
    const chunkQueue = [];

    for (const entry of report.data.files) {
      if (!entry?.path || entry.analysisSkipped) continue;
      activePaths.push(entry.path);
      const absolute = path.resolve(root, entry.path);
      if (!absolute.startsWith(root + path.sep) && absolute !== root) continue;
      let content;
      try {
        const realFile = await fs.realpath(absolute);
        if (!realFile.startsWith(root + path.sep)) continue;
        const stat = await fs.stat(realFile);
        if (!stat.isFile() || stat.size > 2 * 1024 * 1024) continue;
        content = await fs.readFile(realFile, 'utf8');
      } catch { continue; }
      if (content.includes('\u0000')) continue;
      const digest = hashContent(content);
      const existing = existingFiles.get(entry.path);
      if (existing && existing.content_hash === digest) {
        fileIds.set(entry.path, existing.id);
        reusedFilePaths.add(entry.path);
        indexedFiles++;
        reusedFiles++;
        continue;
      }
      if (existing) {
        await client.query('DELETE FROM source_files WHERE id = $1', [existing.id]);
      }
      const fileResult = await client.query(
        `INSERT INTO source_files(project_id, revision_id, path, content_hash, language, size_bytes, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         RETURNING id`,
        [project.id, revision.id, entry.path, digest, guessLanguage(entry.path), Buffer.byteLength(content), JSON.stringify({ isCode: Boolean(entry.isCode), layer: entry.layer || null })]
      );
      fileIds.set(entry.path, fileResult.rows[0].id);
      indexedFiles++;
      const chunks = chunkSourceFile(entry.path, content);
      for (const chunk of chunks) chunkQueue.push({ ...chunk, fileId: fileResult.rows[0].id });
    }

    await client.query(
      'DELETE FROM source_files WHERE revision_id = $1 AND NOT (path = ANY($2::text[]))',
      [revision.id, activePaths]
    );

    const symbols = report.data.functions || [];
    for (const symbol of symbols) {
      const filePath = symbol.file || symbol.path;
      if (reusedFilePaths.has(filePath)) continue;
      const fileId = fileIds.get(filePath);
      if (!fileId) continue;
      await client.query(
        `INSERT INTO symbols(project_id, revision_id, file_id, name, symbol_type, start_line, end_line, is_exported, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
        [project.id, revision.id, fileId, symbol.name || 'anonymous', symbol.type || 'function',
          symbol.line || null, symbol.endLine || null, Boolean(symbol.isExported),
          JSON.stringify({ callers: symbol.callers || [], folder: symbol.folder || null })]
      );
      indexedSymbols++;
    }

    for (const edge of report.data.connections || []) {
      if (!edge?.source || !edge?.target) continue;
      await client.query(
        `INSERT INTO dependency_edges(project_id, revision_id, source_path, target_path, edge_type, metadata)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING`,
        [project.id, revision.id, edge.source, edge.target, edge.type || 'dependency', JSON.stringify(edge)]
      );
    }

    let embeddingErrors = 0;
    const batchSize = 24;
    for (let offset = 0; offset < chunkQueue.length; offset += batchSize) {
      const batch = chunkQueue.slice(offset, offset + batchSize);
      let vectors = null;
      if (embeddingReady) {
        try {
          const response = await providerManager.embed({ provider: embeddingProvider, texts: batch.map((chunk) => chunk.content) });
          vectors = response.embeddings;
          embeddingModel = response.model;
        } catch {
          embeddingErrors++;
        }
      }
      for (let index = 0; index < batch.length; index++) {
        const chunk = batch[index];
        const vector = vectors?.[index] ? vectorLiteral(vectors[index]) : null;
        await client.query(
          `INSERT INTO code_chunks(project_id, revision_id, file_id, chunk_index, start_line, end_line, content, content_hash, embedding, embedding_model, token_estimate)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::vector,$10,$11)`,
          [project.id, revision.id, chunk.fileId, chunk.index, chunk.startLine, chunk.endLine,
            chunk.content, chunk.contentHash, vector, vector ? embeddingModel : null, chunk.tokenEstimate]
        );
        indexedChunks++;
      }
    }

    return {
      projectId: project.id,
      revisionId: revision.id,
      commitSha,
      indexedFiles,
      reusedFiles,
      indexedChunks,
      indexedSymbols,
      dependencyEdges: (report.data.connections || []).length,
      embeddingModel: embeddingReady ? embeddingModel : null,
      embeddingErrors,
      stats: report.data.stats || {}
    };
  });

  return result;
}
