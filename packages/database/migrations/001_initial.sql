CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  root_path text NOT NULL UNIQUE,
  remote_url text,
  default_branch text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repository_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  commit_sha text NOT NULL,
  analyzer_schema_version integer NOT NULL DEFAULT 1,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, commit_sha)
);

CREATE TABLE IF NOT EXISTS source_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES repository_revisions(id) ON DELETE CASCADE,
  path text NOT NULL,
  content_hash text NOT NULL,
  language text,
  size_bytes bigint NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(revision_id, path)
);

CREATE TABLE IF NOT EXISTS symbols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES repository_revisions(id) ON DELETE CASCADE,
  file_id uuid REFERENCES source_files(id) ON DELETE CASCADE,
  name text NOT NULL,
  symbol_type text,
  start_line integer,
  end_line integer,
  is_exported boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS symbols_project_name_idx ON symbols(project_id, lower(name));

CREATE TABLE IF NOT EXISTS dependency_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES repository_revisions(id) ON DELETE CASCADE,
  source_path text NOT NULL,
  target_path text NOT NULL,
  edge_type text NOT NULL DEFAULT 'dependency',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(revision_id, source_path, target_path, edge_type)
);

CREATE INDEX IF NOT EXISTS dependency_edges_source_idx ON dependency_edges(project_id, revision_id, source_path);
CREATE INDEX IF NOT EXISTS dependency_edges_target_idx ON dependency_edges(project_id, revision_id, target_path);

CREATE TABLE IF NOT EXISTS code_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES repository_revisions(id) ON DELETE CASCADE,
  file_id uuid REFERENCES source_files(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL,
  start_line integer NOT NULL,
  end_line integer NOT NULL,
  content text NOT NULL,
  content_hash text NOT NULL,
  embedding vector,
  embedding_model text,
  token_estimate integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(revision_id, file_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS code_chunks_lookup_idx ON code_chunks(project_id, revision_id, embedding_model);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'New conversation',
  provider text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  content text NOT NULL,
  citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages(session_id, created_at);

CREATE TABLE IF NOT EXISTS ai_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  feature text NOT NULL,
  provider text,
  model text,
  status text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(12,6),
  error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision_id uuid REFERENCES repository_revisions(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  severity text NOT NULL,
  category text NOT NULL,
  file_path text NOT NULL,
  line_number integer,
  title text NOT NULL,
  description text NOT NULL,
  evidence text,
  recommendation text,
  confidence numeric(4,3),
  source text NOT NULL DEFAULT 'static',
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS refactor_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  original_hash text NOT NULL,
  replacement text NOT NULL,
  unified_diff text NOT NULL,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','applied','rejected','stale')),
  provider text,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  applied_at timestamptz
);
