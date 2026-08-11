# DoNext

DoNext is an adaptive life planner that helps students decide what to do next while protecting sleep, commitments, goals, and recovery time.

## Current milestone

The project now includes the Phase 1 local foundation, the Phase 2 live manual planner, and the
Phase 3 review-first scheduling workflow:

- Next.js and TypeScript web application
- FastAPI backend
- PostgreSQL persistence, with Redis reserved for later background work
- Email and password authentication
- Core planning data model and CRUD APIs
- Responsive Today, Week, Semester, Courses, Goals, and Settings experiences backed by authenticated user data
- Manual schedule-block creation, editing, moving, linking, locking, and deletion
- Deterministic 14-day schedule proposals that preserve the accepted plan until explicit approval
- Reviewable placement reasons, unresolved-work warnings, stale-input protection, and editable drafts
- User-local day and week planning views with recurring commitments, commute time, availability, and protected buffer calculations
- Semester workload, deadline, capacity, and risk summaries derived from stored tasks and preferences
- Data-backed semester, course, goal, and planning-preference setup
- Required, resumable onboarding for semester dates, course outlines, class schedules, fixed commitments, goals, sleep, and availability
- Local PDF, DOCX, and TXT extraction with document classification, table/calendar parsing, same-course file merging, a review-before-import workflow, and manual-entry fallback

Model-assisted document interpretation and automatic proposal acceptance are intentionally reserved
for later phases. Uploaded outlines use a deterministic local parser and are not sent to an external
AI provider. Today, Week, and Semester read the accepted schedule and planning inputs; a generated
proposal stays separate and editable until the student accepts the complete draft.

New accounts complete onboarding before entering the planner. Each step saves immediately, and incomplete accounts return to setup after signing in. Students can upload outlines, course calendars, and lecture materials together. DoNext groups files by course code, combines complementary evidence, and proposes course details, weighted assessments, deadlines, and recurring class meetings for confirmation. Scanned PDFs without embedded text may require manual entry.

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

Redis is not required for the current application. It will be introduced if schedule generation
moves into background jobs.

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
The live manual-planning milestone is specified in [`docs/architecture/phase-2.md`](docs/architecture/phase-2.md).
The deterministic proposal milestone is specified in [`docs/architecture/phase-3.md`](docs/architecture/phase-3.md).

## Author

Nikhil Dhillon
