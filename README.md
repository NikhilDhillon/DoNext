# DoNext

DoNext is an adaptive life planner that helps students decide what to do next while protecting sleep, commitments, goals, and recovery time.

## Phase 1

The current milestone establishes a polished local foundation:

- Next.js and TypeScript web application
- FastAPI backend
- PostgreSQL and Redis development services
- Email and password authentication
- Core planning data model and CRUD APIs
- Responsive Today, Week, Semester, Courses, and Goals experiences

Automatic scheduling and AI-assisted input are intentionally reserved for later phases.

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
- PostgreSQL 17 and Redis 8, either locally or through Docker

Copy `.env.example` to `.env`, then install dependencies:

```bash
pnpm install
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e 'apps/api[dev]'
```

Start the web application:

```bash
pnpm dev:web
```

Start the API in another terminal:

```bash
source .venv/bin/activate
uvicorn donext.main:app --app-dir apps/api/src --reload
```

API documentation is available at `http://localhost:8000/api/docs`.

## Author

Nikhil Dhillon
