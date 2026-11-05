# CodeFlow AI Dashboard

Local workspace for repository registration, indexing, chat, security auditing and approved refactoring.

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm db:migrate
pnpm dev
```

Open http://127.0.0.1:4174. The API listens on http://127.0.0.1:4317.

Provider credentials are read from server environment variables. The dashboard only selects configured provider/model names and never receives provider API keys. Repository paths must be within `CODEFLOW_ALLOWED_ROOTS`.
