# DoNext Phase 3 scheduling implementation

Author: Nikhil Dhillon

Status: Current implementation snapshot

## Document boundary

This document describes the scheduling system currently present in the repository. It is not the
source of truth for product policy.

The canonical scheduling behavior is specified in [`../scheduling.md`](../scheduling.md). When this
implementation differs from that specification, the difference is an implementation gap—not an
alternative product rule.

## Implemented architecture

Phase 3 provides an explainable, editable 14-day schedule-proposal lifecycle:

1. `POST /api/v1/semesters/{semester_id}/schedule/proposals` creates a separate proposed schedule.
2. Confirmed tasks, academic items, flexible goals, availability, fixed commitments, commute buffers,
   preferences, and preserved blocks are converted into scheduling inputs.
3. A valid greedy baseline is constructed.
4. A deterministic OR-Tools CP-SAT pass attempts to improve the baseline.
5. Generated placements, placement reasons, warnings, capacity totals, and unresolved work are stored
   on the proposal.
6. The student can add, move, edit, duplicate, lock, or delete draft blocks.
7. Acceptance explicitly supersedes the previous accepted version; rejection leaves it untouched.

The horizon starts on the authenticated student's current local date and ends thirteen days later,
bounded by the semester.

## Current constraint construction

`apps/api/src/donext/routers/proposals.py` currently constructs local scheduling windows by:

- expanding availability for each day;
- removing elapsed and freeze-window time;
- subtracting fixed commitments and their commute buffers;
- subtracting preserved schedule blocks;
- excluding the configured wake-to-sleep boundary;
- limiting capacity to `maximum_daily_focus_minutes`; and
- reserving `preserve_free_time_percent` from the focus-limited minutes.

The current implementation treats the preferred sleep window and configured daily focus limit as
generation boundaries. The permission-based extra-focus and preferred-to-minimum sleep escalation in
the canonical specification are not implemented yet.

## Current task construction

Tasks without confirmed deadlines are not scheduled and produce a warning. Course deadlines outside
the semester are quarantined from proposals. Overdue tasks remain eligible and produce an overdue
warning.

The current code uses type-based lead windows:

- 28 days for midterms and finals;
- 21 days for projects and presentations;
- 14 days for assignments and labs; and
- 7 days for quizzes and readings.

Task effort comes from the stored task estimate. Work due beyond the horizon receives a proportional
14-day target rather than the canonical spare-capacity-only rule.

Course meetings are matched from fixed class events. Academic preparation candidate dates are clamped
to the first class meeting when possible. A legacy fallback currently restores pre-lecture dates if
the clamp would leave no candidate date.

## Current optional AI planning

When an OpenAI key is configured, confirmed academic metadata can be sent to a constrained structured
output call. The current model chooses a validated phase and preferred eligible date for each
pre-sized session. It cannot change session minutes, invent a date, create an activity, or choose an
exact calendar time. Invalid or unavailable output falls back per assessment to deterministic local
planning.

The current phases include orient, review, practice, final review, draft, develop, and revise. Titles
are rendered locally from those phases. This is current implementation behavior only; the canonical
specification requires generic exam-prep labels and no AI-authored academic phase experience.

Revision feedback uses a separate constrained AI call only when free text or timing-oriented feedback
needs interpretation. The result is validated into a limited scheduling policy before the
deterministic scheduler sees it. Responses use `store=False`, short timeouts, and deterministic
fallback behavior.

## Exact placement

`apps/api/src/donext/scheduler.py` owns exact placement. It uses:

- five-minute duration units;
- 15-minute candidate start times;
- the student's configured session bounds;
- required break time inside every occupied interval;
- a greedy feasible baseline;
- one CP-SAT worker;
- a fixed random seed; and
- a bounded synchronous solve.

The solver first maximizes academic minutes and recorded academic importance. It then minimizes drift
from preferred academic dates and uses remaining capacity for flexible work, fairness, earlier starts,
and energy matching. If optimization fails or returns a worse academic result, the valid baseline is
used.

Generated blocks store reason details including energy level, priority, importance, session duration,
deadline, and—when applicable—the current academic-planning source and phase.

## Proposal lifecycle

Generation never changes the accepted schedule. A proposal records:

- its base accepted version;
- the 14-day horizon;
- a fingerprint of relevant planning inputs;
- generated and preserved blocks;
- requested, scheduled, eligible-capacity, and protected-free minutes;
- warnings and unresolved work;
- academic-planning source; and
- revision feedback and change counts when applicable.

Acceptance recomputes the input fingerprint and returns `PROPOSAL_STALE` when tasks, goals, events,
availability, preferences, semester dates, timezone, or accepted schedule state changed after
generation. Automatic acceptance is disabled.

## Review experience

The draft-review screen keeps the proposal separate from accepted Today and Week data. It provides:

- generation and regeneration states;
- scheduled-versus-requested totals;
- warnings and stale-proposal errors;
- a seven-day desktop calendar and mobile day agenda;
- fixed classes and commitments alongside editable generated blocks;
- drag, edit, duplicate, delete, add, and undo interactions;
- outside-focus warnings;
- unresolved work; and
- explicit reject/revise and accept actions.

## Canonical-policy gaps

The following work is required before the current implementation satisfies
[`../scheduling.md`](../scheduling.md):

| Area | Current implementation | Canonical requirement |
| --- | --- | --- |
| Assignment readiness | Preparation dates are clamped to the first lecture when possible; a fallback can bypass the clamp. | Every assignment is blocked until at least one lecture has ended; invalid pre-lecture deadlines are flagged. |
| Assignment effort | Stored task estimates drive scheduling. | Initial assignment effort defaults to 2.5 hours without prompting, then may learn per-course patterns. |
| Long-range assignments | Type-based lead windows and proportional horizon targets. | After the first lecture, distant assignments use only otherwise-unused capacity and normally preserve personal goals. |
| Exam activation | Midterms and finals can enter planning 28 days ahead. | Midterms and finals activate only inside the rolling 14-day window. |
| Exam effort | Derived from task estimates and session rules. | Ask for preparation hours on horizon entry; use an explicit eight-hour fallback. |
| Quizzes | Seven-day lead window using stored effort. | Use a two-hour preparation default. |
| Academic labels | AI or fallback phases produce phase-specific titles. | Use generic exam-prep labels and confirmed assignment identities. |
| Exam cadence | Preferred dates are spread and phase-ordered. | Prepare continuously on reasonable-capacity days; keep a soft 30-to-45-minute review approximately every three days when assignments dominate. |
| Exam relationships | No explicit same-course pre-exam assignment boost or post-exam assignment gate. | Boost same-course assignments due before the exam and hold post-exam assignments until required prep is actually complete. |
| Simultaneous exams | No explicit cross-exam fairness rule. | Prepare for overlapping exams simultaneously using date, remaining hours, weight, and feasibility. |
| Deadline risk | Required status, deadline proximity, stated priority, and weight contribute to importance. | Add explicit overdue ordering, 48-hour urgency, remaining-slack feasibility, 24-hour completion targets, and agreed tie-breakers. |
| Session construction | Sessions respect stored min/preferred/max sizes and breaks. | Preserve this behavior, allow multiple same-day blocks, and never lengthen sessions to resolve risk. |
| Rollover capacity | A configurable percentage is protected. | Prefer one intentionally unallocated hour per day and consume it automatically for overdue or 48-hour work. |
| Personal goals | Flexible work competes after academic coverage. | Explicitly reduce flexible goals before current-horizon academics, but preserve them from distant spare-capacity work. |
| Extra focus | Daily focus limit is a hard generation cap. | Ask permission before using additional waking focus capacity. |
| Sleep | Preferred wake-to-sleep window is excluded. | After the extra-focus decision, reduce preferred sleep toward the configured minimum if pressure remains and inform the student. |
| Infeasibility | Partial proposals show unresolved minutes and capacity reasons. | Retain honesty while dropping academic work by optionality, weight, deadline, and exam relationship. |
| Adaptive estimates | Not implemented. | Future daily completion data may learn course-specific effort and feed a new reviewable proposal. |

## Validation boundary

Current Phase 3 tests cover deterministic placement, feasible fallback, hard conflicts, pacing,
overload reporting, session splitting, energy preferences, timezones, proposal editing, rejection,
stale detection, atomic acceptance, rollback, and user isolation.

The canonical acceptance scenarios in [`../scheduling.md`](../scheduling.md) must be added alongside
implementation changes. Documentation alone does not satisfy those scenarios.
