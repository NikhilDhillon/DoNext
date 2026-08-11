# DoNext Phase 2 live planning architecture

Author: Nikhil Dhillon

## Purpose

Phase 2 turns the Phase 1 data foundation into a usable manual planner. Today, Week, and
Semester will be computed from the authenticated student's real courses, tasks, goals,
commitments, availability, preferences, and schedule blocks.

Automatic schedule generation remains a Phase 3 concern. Phase 2 establishes the same
schedule storage and read contracts that a deterministic scheduler can use later without
changing the planner UI.

## Schedule lifecycle

Each semester can have schedule versions. At most one version is accepted at a time:

- The first manual planning action creates and accepts a manual schedule version.
- Manual blocks belong to the accepted version and remain directly editable by the user.
- User-created or user-adjusted blocks use `source=manual` and may be locked.
- A future scheduler will create an immutable proposed version rather than changing the
  accepted version.
- Accepting a proposal supersedes the previously accepted version in one transaction.
- Rejecting a proposal leaves the accepted version untouched.

Phase 2 exposes the accepted manual schedule through planner-oriented endpoints instead of
making the web application manage version numbers directly.

## API contract

All endpoints are authenticated and scoped to the current user.

### Schedule editing

- `GET /api/v1/semesters/{semester_id}/schedule`
- `POST /api/v1/semesters/{semester_id}/schedule/blocks`
- `PATCH /api/v1/schedule-blocks/{block_id}`
- `DELETE /api/v1/schedule-blocks/{block_id}`

A block can link to one task, fixed event, or goal. The API validates ownership, semester
membership, ordered timestamps, and overlap with locked blocks. Fixed commitments are not
copied into manual schedule blocks; planner read models expand and combine them at query time.

### Planner views

- `GET /api/v1/planning/day?date=YYYY-MM-DD`
- `GET /api/v1/planning/week?start=YYYY-MM-DD`
- `GET /api/v1/planning/semesters/{semester_id}`

Day and week boundaries use the authenticated user's IANA timezone. Responses contain ISO 8601
timestamps with offsets so the browser does not infer the server timezone.

## Read-model rules

Planner entries combine:

1. Fixed one-time and recurring commitments.
2. Blocks in the accepted schedule version.
3. Linked task, goal, and course context.

Capacity is deterministic and explainable:

- Availability windows define potential focus time.
- Unavailable windows, fixed commitments, and commute buffers reduce that potential.
- The configured free-time percentage remains protected.
- Scheduled focus blocks count as allocated focus.
- Sleep is reported from preferences and is never consumed as capacity.

The first Phase 2 release will not infer that unscheduled work has been planned. Semester demand
comes from remaining task estimates, while capacity comes from availability and fixed commitments.
Any risk label must be derived from those values and must identify incomplete input instead of
presenting uncertain data as fact.

## Recurrence

Phase 2 expands the weekly recurrence rules created by onboarding. Expansion is bounded by the
requested day or week and the associated semester. Unsupported recurrence clauses remain visible
as source commitments and produce a review warning rather than silently inventing occurrences.

## Web application

Today and Week become interactive client surfaces because they support authenticated reads and
mutations against the separate FastAPI service. Route `page.tsx` files remain small Server
Components that render focused client planner components.

The first release uses accessible forms and explicit move/edit controls. Drag-and-drop is not a
prerequisite and can be added only after keyboard and touch workflows are complete.

## Validation gate

Phase 2 is complete when:

- Today and Week contain no representative fixture data.
- A user can create, edit, move, and remove a real manual block.
- Recurring commitments appear on the correct local dates.
- Completing a linked task updates the planner.
- Cross-user schedule access returns `NOT_FOUND`.
- Daylight-saving and timezone boundaries have regression coverage.
- Semester demand and capacity are derived from stored data.
- The full repository quality gate, migration cycle, and browser checks pass.
- Desktop and 390px layouts have no console errors, overlays, or horizontal overflow.

