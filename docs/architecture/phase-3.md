# DoNext student-aware scheduling implementation

Author: Nikhil Dhillon

Status: Current implementation snapshot

## Document boundary

This document describes the scheduling implementation in the repository. The canonical product
policy remains [`../scheduling.md`](../scheduling.md).

## Architecture

DoNext builds an editable proposal for exactly 14 local calendar days while using the complete
semester as strategic context. Proposal construction is deterministic:

1. `proposals.py` builds course readiness, effective weights, remaining work, deadlines, exam
   relationships, slack, availability, commitments, sleep boundaries, and capacity passes.
2. `scheduler.py` creates normal-sized sessions and runs the same hard constraints through a greedy
   baseline and a deterministic single-worker OR-Tools CP-SAT optimization.
3. Generated placements and typed trade-off summaries are saved on a separate proposed schedule.
4. The student may edit or reject the proposal. Explicit acceptance atomically supersedes the prior
   accepted schedule after its expanded input fingerprint is revalidated.

No OpenAI call participates in academic selection, effort allocation, exact placement, capacity
escalation, or acceptance. Schedules are identical whether an OpenAI key exists or not.

## Academic inputs

Class events carry a `course_id` and `meeting_kind`. Scheduled-course assignments become actionable
at the end of the first linked lecture. Asynchronous courses use `first_content_available_at`.
Missing readiness and deadlines that predate readiness are reported for correction. Recurring
lectures are expanded in local time through semester end. Exam preparation unlocks cumulatively in
proportion to completed lectures, with the final lecture releasing the exact remainder; asynchronous
courses release the full estimate at their content-available timestamp.

Academic items are created atomically with their tasks. Assignment, quiz, midterm, and final defaults
are 150, 120, 480, and 480 minutes respectively. Exam defaults begin with `pending_exam`; proposal
generation pauses until the student enters an estimate or explicitly chooses the eight-hour default.
`remaining_minutes` remains the scheduling source of truth.

Assignments remain eligible after readiness even when their deadlines are beyond the current
horizon. A deterministic daily max-flow forecast tests known future required demand against
optimistic post-horizon capacity through semester end. Only a proven deficit becomes a required
strategic-lead portion; the rest remains opportunistic behind flexible goals. Unknown future exam
estimates are reported but add no demand. Exams activate only when their deadline is inside the
14-day horizon. Exam blocks use generic labels such as `CSC 370 · Midterm prep`.

## Risk and allocation

Every generation captures one injectable planning instant. Each academic scheduling item carries
explicit metadata for required status, readiness, deadline, 24-hour assignment completion target,
remaining effort, slack, exam relationship, and effective or unknown weight. Both scheduling paths
use the canonical lexicographic bands: required status, overdue state, exact 48-hour urgency,
same-course pre-exam relationship, slack, local due date, same-date known weight, exact deadline,
remaining work, and stable ID. Overdue weight is compared only when both values are known. Unknown
weight is never converted into an invented value.

The scheduler preserves configured minimum, preferred, and maximum session sizes with exact
integer-minute durations and 15-minute-aligned starts. It schedules the largest exact valid
partition and reports any sub-minimum remainder. Multiple sessions retain required separation, but
the final session does not require a trailing break. Required academic coverage is optimized before
optional academics, flexible work, and distant opportunistic assignments. Greedy fallback follows
the same priority bands and hard constraints. Simultaneous exams each receive a valid session when
capacity permits before remaining capacity follows slack, date, remaining estimate, and known
weight. Early-review cadence is derived from actual proposed assignment completion and is omitted
with a warning when saved session bounds do not overlap 30–45 minutes.

## Capacity passes

Proposal construction uses explicit escalation passes:

1. normal waking availability, preferred daily focus, fixed commitments, breaks, and a 60-minute
   daily rollover buffer;
2. buffer release when overdue or 48-hour work remains;
3. flexible-goal reduction through academic-first allocation;
4. a comparison solve using waking capacity above the preferred focus cap, maximizing protected
   required work and then minimizing total, peak-daily, and deterministic per-day excess;
5. an exact-vector, fingerprinted permission response before that extra focus may be used; and
6. incremental preferred-sleep reduction toward the hard minimum, followed by honest unresolved
   work if required academics still cannot fit.

For each sleep-reduction pass, the window builder measures contiguous usable availability at the
bedtime and wake-time edges after fixed exclusions. It unlocks the edge with the stronger saved
energy first, then the larger usable capacity, using the other edge only when necessary. Generated
block details and the proposal summary report only the reduced-sleep capacity actually consumed.

The extra-focus response includes a fingerprint, required minutes gained, exact per-day approved
capacity, protected work, and residual shortfall. Stale fingerprints are rejected by issuing a newly
calculated request, and approved generation is capped to that vector.
Generation rolls back before returning either an exam-estimate or extra-focus requirement, so the
current proposal is not superseded while input is pending.

Both onboarding and regeneration render those response details before the one-draft decision: each
affected date shows the extra and resulting focus totals, and each protected item shows its deadline
and remaining work at risk.

Proposal summaries report academic coverage, proportional material release, semester-pressure
checkpoints, exam estimates and sources, opportunistic work, flexible reductions, rollover use,
extra focus, sleep changes, and counterfactual unresolved-work diagnostics. Generated blocks store
a versioned explanation with priority, readiness, remaining work, deadline, slack, exam and weight
effects, requested and chosen energy, capacity source, and verified displacement. Legacy blocks use
generic fallback copy. Fixed events and the student's minimum sleep never move.

## Optional revision interpretation

OpenAI is optional and limited to translating free-text revision feedback into a validated soft
policy: preferred or avoided time ranges, block density, session-length direction within the saved
bounds, and flexible-goal balancing. The developer instruction treats feedback and names as
untrusted text and forbids changes to deadlines, work remaining, readiness, weights, availability,
capacity, consent, sleep, fixed events, exact blocks, IDs, or acceptance.

The call uses structured Responses output, `store=False`, no retries, a short timeout, and a local
fallback. Pydantic rejects unknown fields before the deterministic scheduler sees the policy.

## Product flow

Onboarding and regeneration both fetch generation requirements before creating a proposal. Exams in
range prompt for preparation hours, with an explicit eight-hour default. Extra-focus permission is
valid for one draft only. Sleep reduction is reported in review rather than prompting a second time.
The previous draft remains visible until replacement generation succeeds.

The review experience preserves editable blocks, warnings, placement reasons, unresolved work,
stale-input protection, rejection/revision, and explicit acceptance. Accepted Today and Week views
remain isolated from unaccepted proposals.

## Canonical conformance

The scheduling pipeline implements the current decisions in `docs/scheduling.md`. Named regression
tests cover the 17 acceptance scenarios and the selected clarifications, including urgency versus
pre-exam priority, slack-driven early starts, known and unknown weight behavior, proportional
lecture release, future-pressure promotion, simultaneous exams, exact durations, recovery-layer
isolation, sleep reporting, truthful displacement, and proposal lifecycle safety. Shared hard and
priority cases run through CP-SAT and forced greedy fallback.



## Out of scope

Daily completion check-ins, partial block completion, and learned course-specific effort estimates
remain future work. The calendar's visual redesign is also separate from this scheduling cutover.

## Verification

The repository test suite covers API contracts, defaults and provenance, linked and proportional
class readiness, semester pressure, proposal lifecycle, core hard scheduling constraints, recovery
layers, fallback behavior, revision-AI boundary, and stale input protection. On 2026-09-02,
`pnpm check` passed with 97 API tests plus frontend lint, typecheck, and production build. Database
schema did not change, so no migration was required for this cutover.
