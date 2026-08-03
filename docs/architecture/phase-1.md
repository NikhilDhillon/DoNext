# DoNext Phase 1 architecture

Author: Nikhil Dhillon

## Purpose

Phase 1 creates the product and data foundation for DoNext without prematurely implementing automatic scheduling or AI-assisted input.

## Runtime boundaries

```text
Browser
  -> Next.js web application
  -> FastAPI REST API
       -> PostgreSQL
       -> Redis in later background-job phases
       -> isolated scheduling package in Phase 3
```

The web application and API are separate deployable applications. The scheduling engine will initially remain an isolated Python package invoked by a background worker. It can become a separate service later without changing the public REST API.

## Web application

- Next.js App Router and strict TypeScript
- Server Components by default
- Client Components limited to navigation state and authentication forms
- Responsive navigation for desktop and mobile
- WCAG-oriented focus styles, semantic headings, labels, and reduced-motion support
- A small typed API client with credentialed requests and structured error handling

Today, Week, and Semester use representative data in Phase 1. They define the intended information hierarchy while the manual planner and deterministic scheduler are built in later phases.

## API

- FastAPI with Pydantic request and response validation
- Versioned endpoints under `/api/v1`
- OpenAPI documentation under `/api/docs`
- Structured error envelopes with stable error codes
- SQLAlchemy 2 models and explicit Alembic migrations
- UTC-capable timestamps with a separate user timezone

Phase 1 exposes authentication and user-scoped CRUD for semesters, courses, tasks, fixed events, goals, and availability.

## Authentication and authorization

- Email and password only
- Argon2id password hashing through the recommended password-hash configuration
- Random 384-bit session tokens
- Only SHA-256 token digests are stored in the database
- HTTP-only, SameSite cookies
- Secure cookies enabled in production
- Every user-owned query is scoped by the authenticated user
- Cross-user access returns `NOT_FOUND` to avoid confirming resource existence

Password reset and email delivery are intentionally deferred until a local email-capture service and expiry workflow are implemented together.

## Data integrity

Important planning rules are enforced twice:

1. Pydantic validates requests and provides useful feedback.
2. PostgreSQL constraints protect the source of truth from invalid writes outside the API.

Examples include semester date ordering, positive task effort, ordered goal effort ranges, valid availability windows, and end times after start times.

Schedule versions and scheduled blocks exist in the schema now, but automatic schedule generation does not. Later phases will append proposed versions instead of overwriting accepted schedules.

## Local services

Docker Compose defines PostgreSQL and Redis. The API and web application run directly on the host for fast local reloads. No paid or hosted resources are required for Phase 1.

## Quality gate

The repository quality gate runs:

- ESLint
- TypeScript type checking
- Ruff linting and formatting checks
- mypy strict checking
- pytest API and authorization tests
- Next.js production build

Migration validation additionally performs an Alembic upgrade, schema-drift check, and downgrade against an isolated database.
