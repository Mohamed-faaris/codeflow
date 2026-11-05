import { getPool, vectorLiteral } from '@codeflow/database';
import { createProviderManager } from './providers.js';

function queryTerms(text) {
  return [...new Set(String(text).toLowerCase().split(/[^a-z0-9_.$/-]+/).filter((term) => term.length >= 3))].slice(0, 12);
}

export async function retrieveContext(options) {
  const limit = Math.max(1, Math.min(Number(options.limit) || 8, 20));
  const pool = getPool();
  const revisionResult = await pool.query(
    'SELECT id, commit_sha FROM repository_revisions WHERE project_id = $1 ORDER BY indexed_at DESC LIMIT 1',
    [options.projectId]
  );
  const revision = revisionResult.rows[0];
  if (!revision) throw new Error('Project has not been indexed yet');

  const providerManager = options.providerManager || createProviderManager();
  const embeddingProvider = options.embeddingProvider || process.env.EMBEDDING_PROVIDER || 'openai';
  let queryVector = null;
  let embeddingModel = null;
  try {
    const status = providerManager.list().find((item) => item.id === embeddingProvider);
    if (status?.configured && status.capabilities.embeddings) {
      const response = await providerManager.embed({ provider: embeddingProvider, texts: [options.query] });
      queryVector = vectorLiteral(response.embeddings[0]);
      embeddingModel = response.model;
    }
  } catch {
    // Lexical retrieval remains available when embedding credentials or service are absent.
  }

  let rows = [];
  if (queryVector && embeddingModel) {
    const vectorResult = await pool.query(
      `SELECT f.path, c.start_line, c.end_line, c.content,
              1 - (c.embedding <=> $1::vector) AS score
       FROM code_chunks c
       JOIN source_files f ON f.id = c.file_id
       WHERE c.project_id = $2 AND c.revision_id = $3
         AND c.embedding IS NOT NULL AND c.embedding_model = $4
       ORDER BY c.embedding <=> $1::vector
       LIMIT $5`,
      [queryVector, options.projectId, revision.id, embeddingModel, limit]
    );
    rows = vectorResult.rows;
  }

  if (rows.length < limit) {
    const terms = queryTerms(options.query);
    if (terms.length) {
      const lexicalResult = await pool.query(
        `SELECT f.path, c.start_line, c.end_line, c.content, 0.25::float AS score
         FROM code_chunks c
         JOIN source_files f ON f.id = c.file_id
         WHERE c.project_id = $1 AND c.revision_id = $2
           AND (${terms.map((_, index) => 'c.content ILIKE $' + (index + 3)).join(' OR ')})
         ORDER BY f.path, c.start_line
         LIMIT $${terms.length + 3}`,
        [options.projectId, revision.id, ...terms.map((term) => '%' + term.replace(/[%_\\]/g, '\\$&') + '%'), limit - rows.length]
      );
      const seen = new Set(rows.map((row) => row.path + ':' + row.start_line));
      rows.push(...lexicalResult.rows.filter((row) => !seen.has(row.path + ':' + row.start_line)));
    }
  }

  return {
    revision: revision.commit_sha,
    results: rows.slice(0, limit).map((row) => ({
      path: row.path,
      startLine: row.start_line,
      endLine: row.end_line,
      content: row.content,
      score: Number(row.score || 0)
    }))
  };
}
