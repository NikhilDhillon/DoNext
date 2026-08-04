# DoNext

DoNext is an adaptive life planner that helps students decide what to do next while protecting sleep, commitments, goals, and recovery time.

## Phase 1

The current milestone establishes a polished local foundation:

- Next.js and TypeScript web application
- FastAPI backend
- PostgreSQL persistence, with Redis reserved for later background work
- Email and password authentication
- Core planning data model and CRUD APIs
- Responsive Today, Week, Semester, Courses, Goals, and Settings experiences
- Data-backed semester, course, goal, and planning-preference setup
- Required, resumable onboarding for semester dates, courses, syllabus deadlines, fixed commitments, goals, sleep, and availability

Automatic scheduling and AI-assisted input are intentionally reserved for later phases.
Today, Week, and Semester currently use representative planning data so the product experience can be evaluated before the deterministic scheduling engine is introduced.

New accounts complete onboarding before entering the planner. Each step saves immediately, and incomplete accounts return to setup after signing in. Course-outline deadlines are entered manually in Phase 1; document import is reserved for the evaluated AI-assisted input phase.

## Repository layout

```text
apps/
  api/       FastAPI application
  web/       Next.js application
infrastructure/
  docker-compose.yml
```

## Local setup

Requirements:

- Node.js 22 or later
- pnpm 11 or later
- Python 3.13 or later
- PostgreSQL 14 or later, installed locally or through Docker

Redis is not required for the current Phase 1 application. It will be introduced when schedule generation moves into background jobs.

Copy `.env.example` to `.env`, then install dependencies:

```bash
pnpm install
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e 'apps/api[dev]'
```

If Docker is installed, start PostgreSQL and Redis:

```bash
docker compose --env-file .env -f infrastructure/docker-compose.yml up -d
```

If PostgreSQL is already running locally, Docker is unnecessary. Create the local application role and database from an administrator account:

```bash
psql -U "$USER" -d postgres
```

Then run:

```sql
CREATE ROLE donext WITH LOGIN PASSWORD 'donext_local';
CREATE DATABASE donext OWNER donext;
\q
```

The password above is only a local development credential and matches `.env.example`. Do not reuse a personal or production password.

Apply the database migration:

```bash
pnpm migrate:api
```

Start the web application:

```bash
pnpm dev:web
```

Start the API in another terminal:

```bash
pnpm dev:api
```

API documentation is available at `http://localhost:8000/api/docs`.

## Validation

Run the complete local quality gate:

```bash
pnpm check
```

The API test suite uses an isolated in-memory SQLite database. PostgreSQL remains the production source of truth and Alembic migrations are also checked independently.

## Architecture

Phase 1 architecture and security decisions are documented in [`docs/architecture/phase-1.md`](docs/architecture/phase-1.md).

## Author

Nikhil Dhillon
