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
Missing readiness and deadlines that predate readiness are reported for correction.
Assignment, quiz, midterm, and final work cannot begin before that readiness timestamp, so generic
exam preparation is never placed before any course material is available.

Academic items are created atomically with their tasks. Assignment, quiz, midterm, and final defaults
are 150, 120, 480, and 480 minutes respectively. Exam defaults begin with `pending_exam`; proposal
generation pauses until the student enters an estimate or explicitly chooses the eight-hour default.
`remaining_minutes` remains the scheduling source of truth.

Assignments remain eligible after readiness even when their deadlines are beyond the current
horizon. Those distant assignments are classified as opportunistic and compete only after current
academic work and flexible goals. Exams activate only when their deadline is inside the 14-day
horizon. Exam blocks use generic labels such as `CSC 370 · Midterm prep`.

## Risk and allocation

Every academic scheduling item carries explicit metadata for required status, readiness, deadline,
24-hour assignment completion target, remaining effort, slack, exam relationship, and effective or
unknown weight. Allocation prioritizes required work, overdue work, 48-hour urgency, pre-exam
same-course assignments, lower slack, earlier deadlines, remaining effort, and known effective
weight. Unknown weight is never converted into an invented value.

The scheduler preserves configured minimum, preferred, and maximum session sizes. It may place
multiple sessions on one day but always reserves the configured break and never lengthens a session
to make overload disappear. Required academic coverage is optimized before optional academics,
flexible work, and distant opportunistic assignments. Greedy fallback follows the same priority
bands and constraints. When simultaneous exams cannot both be completed, the greedy path
round-robins their sessions and CP-SAT maximizes the minimum completion ratio before allocating
remaining exam capacity by the existing date, slack, effort, and weight signals. Required
same-course pre-exam assignment coverage is protected before that fairness pass.

## Capacity passes

Proposal construction uses explicit escalation passes:

1. normal waking availability, preferred daily focus, fixed commitments, breaks, and a 60-minute
   daily rollover buffer;
2. buffer release when overdue or 48-hour work remains;
3. flexible-goal reduction through academic-first allocation;
4. a comparison solve using waking capacity above the preferred focus cap;
5. an exact-draft permission response before that extra focus may be used; and
6. incremental preferred-sleep reduction toward the hard minimum, followed by honest unresolved
   work if required academics still cannot fit.

For each sleep-reduction pass, the window builder measures contiguous usable availability at the
bedtime and wake-time edges after fixed exclusions. It unlocks the edge with the stronger saved
energy first, then the larger usable capacity, using the other edge only when necessary. Generated
block details and the proposal summary report only the reduced-sleep capacity actually consumed.

The extra-focus response includes a fingerprint, total and per-day extra minutes, resulting daily
focus, and protected work. Stale fingerprints are rejected by issuing a newly calculated request.
Generation rolls back before returning either an exam-estimate or extra-focus requirement, so the
current proposal is not superseded while input is pending.

Both onboarding and regeneration render those response details before the one-draft decision: each
affected date shows the extra and resulting focus totals, and each protected item shows its deadline
and remaining work at risk.

Proposal summaries report academic coverage, exam estimates and sources, opportunistic work,
flexible reductions, rollover use, extra focus, sleep changes, and unresolved work. Fixed events and
the student's minimum sleep never move.

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

## Known gaps against the scheduling specification

The student-aware cutover establishes the intended architecture, but the following behavior is not
fully implemented yet:

- **Early exam-review cadence:** the optimizer rewards using more exam-preparation days after
  academic coverage is fixed, but it does not explicitly target one 30-to-45-minute review block
  approximately every three days while urgent pre-exam assignments are still underway, nor does it
  minimize excessive gaps as preparation intensifies.
- **Per-block displacement explanations:** block reasons contain readiness, deadline, slack, exam
  relationship, weight, energy, and capacity-source details. They do not yet identify the specific
  flexible or academic alternative that lost capacity because that block was selected.
- **Canonical acceptance coverage:** the suite covers many of the required behaviors, but it does
  not yet encode all 17 scenarios in `docs/scheduling.md` as explicit automated acceptance tests.
  Missing explicit coverage includes the pre-exam versus 48-hour priority interaction, slack-driven
  early starts, effective-weight and unknown-weight ties, sleep fallback reporting, least-important
  academic sacrifice, and equivalent hard-constraint checks for both greedy and CP-SAT paths.

Until these gaps are implemented and tested, this snapshot should not be treated as complete
conformance with `docs/scheduling.md`.

## Out of scope

Daily completion check-ins, partial block completion, and learned course-specific effort estimates
remain future work. The calendar's visual redesign is also separate from this scheduling cutover.

## Verification

The repository test suite currently covers the API contracts, defaults and provenance, linked class
readiness, proposal lifecycle, core hard scheduling constraints, fallback behavior, revision-AI
boundary, and stale input protection. Delivery validation includes an isolated Alembic
upgrade-downgrade-upgrade cycle, API lint/type/tests, frontend lint/type/build, and the
repository-wide `pnpm check`. The missing acceptance coverage listed above remains required before
the scheduling specification can be considered fully implemented.
