# SwarmDev

A multi-agent collaboration platform: run AI agents on local CLI runtimes or hosted APIs, compose them into teams on a visual canvas, execute multi-agent workflows inside project workspaces, and share agents through a marketplace.

## Structure

```
backend/    Express + TypeScript API, WebSocket gateway, workflow engine (Postgres + Drizzle)
frontend/   Next.js 14 web app
desktop/    Electron client (planned)
```

## Development

```bash
docker compose up -d          # Postgres on localhost:5434
cd backend && npm install && npm run db:migrate && npm run dev
cd frontend && npm install && npm run dev
```

Backend serves REST and WebSocket on a single port (default 4000). See `backend/.env.example` and `frontend/.env.example` for configuration.
