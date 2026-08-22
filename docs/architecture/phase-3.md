# DoNext Phase 3 deterministic scheduling architecture

Author: Nikhil Dhillon

## Purpose

Phase 3 generates an explainable, editable 14-day schedule proposal from confirmed planning
inputs. Generation never changes the accepted schedule. The student reviews a separate draft,
edits it if needed, and explicitly accepts or rejects the complete version.

## Scheduling policy

- The horizon is the user's local current date plus thirteen days.
- Manual, locked, and freeze-window blocks are preserved exactly.
- Sleep, availability, fixed events, commutes, daily focus limits, breaks, and protected free
  time are hard constraints.
- Only tasks with confirmed deadlines are scheduled. Undated tasks remain visible with a warning.
- Course deadlines outside the selected semester are invalid planning inputs. Import rejects them,
  and legacy records are quarantined from proposals with a course-level warning rather than being
  treated as overdue work.
- Work enters the proposal only inside an evidence-based lead window: 28 days for exams, 21 days
  for projects and presentations, 14 days for assignments and labs, and 7 days for quizzes and
  readings. A user-confirmed earliest start may narrow that window further.
- Generated work may not start before its planning boundary or finish after its confirmed deadline.
  On the current day, elapsed time and the freeze window are ineligible.
- Flexible goals receive maintenance time before preferred time during constrained weeks.
- A deterministic OR-Tools CP-SAT model uses five-minute granularity, one worker, a fixed seed,
  and a five-second solve limit.
- Optimization is staged lexicographically so the product does not hide invented trade-off
  weights: maximum required dated work, earlier deadlines, required versus optional status,
  stated priority and grading impact, goal maintenance, stability, then session and energy
  preferences. When all selected academic work fits, the same ordering places earlier-deadline
  work into earlier available blocks.

Partial proposals are honest outcomes. They list unscheduled minutes and the constraints that
prevented placement instead of claiming all work fits.

## Version lifecycle

Generation copies the accepted semester schedule into a new `proposed` version, preserves blocks
outside the horizon, and replaces only eligible generated blocks inside it. A proposal is a
mutable draft: the student may add, move, resize, link, lock, or remove blocks. Acceptance makes
the draft immutable and supersedes the previously accepted version in one transaction. Rejection
leaves the accepted version untouched.

Every proposal stores its base version, horizon, a fingerprint of scheduling inputs, a validated
generation summary, and per-block placement reasons. Acceptance recomputes the fingerprint and
returns `PROPOSAL_STALE` if tasks, goals, events, availability, preferences, semester dates,
timezone, or the accepted schedule changed after generation.

## Review experience

Week is the primary review surface. Accepted and Draft views remain separate, changed blocks are
identified, placement reasons are expandable, and unresolved work is visible before acceptance.
Today continues to show accepted work and links to a pending draft. Semester may preview the
draft's workload effect but never presents it as accepted.

Automatic low-impact acceptance remains disabled in this phase even though the preference is
stored. Redis and background generation remain deferred until the synchronous 14-day solver no
longer meets the response-time target.

## Validation gate

- Identical inputs produce identical proposals.
- Hard constraints, pacing, overload, goal maintenance, stability, and DST behavior have tests.
- Draft editing, rejection, stale detection, atomic acceptance, rollback, and user isolation pass.
- The accepted planner is unchanged until acceptance.
- PostgreSQL migration cycling and the complete repository quality gate pass.
- Desktop and 390px proposal workflows have no console errors, overlays, or page overflow.
