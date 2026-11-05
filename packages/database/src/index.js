import pg from 'pg';

const { Pool } = pg;
let pool;

export function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL features');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: true } : undefined
  });
  pool.on('error', (error) => {
    process.stderr.write('[codeflow-db] idle client error: ' + error.message + '\n');
  });
  return pool;
}

export async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function transaction(callback) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}

export function vectorLiteral(values) {
  if (!Array.isArray(values) || values.length === 0 || values.length > 8192) {
    throw new Error('Embedding vector is empty or exceeds the supported dimension limit');
  }
  if (values.some((value) => !Number.isFinite(Number(value)))) {
    throw new Error('Embedding contains a non-finite value');
  }
  return '[' + values.map((value) => Number(value)).join(',') + ']';
}
