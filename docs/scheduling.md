# DoNext scheduling product specification

Author: Nikhil Dhillon

Status: Canonical product source of truth

Last decision review: 2026-09-01

## Purpose

DoNext should plan the way a thoughtful student would plan: understand the whole semester, respect
the realities of each day, start useful work as soon as it is genuinely actionable, and continuously
choose the work that best reduces academic risk.

This document is the authoritative specification for scheduling behavior. It replaces older product
rules embedded in milestone or architecture documents. Historical architecture documents may still
describe what a particular implementation currently does, but they do not override this policy.

The rules below describe the intended product behavior. A rule is not considered implemented merely
because it appears here. Current implementation coverage and known gaps are recorded in
[`architecture/phase-3.md`](architecture/phase-3.md).

## Product mental model

DoNext is not a calendar that packs every task into the next empty slot. It is a semester-aware
academic decision system with a rolling execution window.

The student should be able to trust that DoNext:

- understands what is fixed and what can move;
- knows which academic work is actually ready to begin;
- accounts for deadlines, grade weight, remaining effort, and upcoming exams together;
- starts actionable assignments early instead of manufacturing avoidable pressure later;
- preserves realistic session lengths and breaks;
- reduces lower-value flexible work before sacrificing important academics;
- never schedules below the student's minimum sleep boundary;
- shows every trade-off and shortfall instead of hiding overload; and
- keeps a generated plan separate from the accepted schedule until the student approves it.

## Planning model

### Semester strategy

DoNext uses the complete semester as strategic context. It reads all confirmed semester dates,
class meetings, assignments, quizzes, midterms, finals, fixed commitments, grade weights, and
remaining work estimates when deciding what should be started early.

The semester layer identifies future pressure, dependencies, and opportunities to front-load work.
It does not create exact calendar blocks months in advance. A semester-long block schedule would
become stale too quickly and would imply precision that the product cannot honestly provide.

### Rolling 14-day execution plan

Exact dates and times are proposed only for the student's next 14 local calendar days. The horizon
starts on the current local date and ends thirteen days later, bounded by the semester.

The entire semester can influence a 14-day decision, but only work placed inside the current horizon
appears as an executable calendar block.

This separation answers two different questions:

- Semester strategy: what is coming, and where will pressure build?
- Fourteen-day plan: what should the student work on, and when?

## Source-of-truth inputs

Scheduling uses confirmed data only:

- semester start and end dates;
- course identities and class meetings;
- assignment, quiz, midterm, and final dates;
- grade weights when known;
- task status and remaining work;
- fixed and recurring commitments, including commute buffers;
- availability and energy levels;
- preferred and minimum sleep;
- preferred daily focus limit;
- preferred, minimum, and maximum session lengths;
- required breaks;
- flexible personal goals; and
- the currently accepted schedule and locked work.

DoNext must not invent deadlines or grade weights. When an assignment weight is unknown, deadline
and feasibility drive its priority. Unknown values stay visibly unknown.

## Academic readiness

### Assignment readiness gate

An assignment becomes actionable after at least one lecture for its course has occurred.

- A scheduled lecture counts as attended automatically once its end time has passed.
- The student is not required to confirm attendance to unlock assignment work.
- The assignment may be scheduled in the earliest reasonable opening after that lecture, including
  later on the same day.
- Before the first lecture has occurred, the assignment remains blocked.

Course data is expected not to contain an assignment due before its first lecture. If invalid or
legacy data violates that invariant, DoNext must flag the conflict for correction rather than quietly
pretending the course-readiness rule does not exist.

### Exam-material readiness

Exam preparation may cover only material that has already been taught. When lectures remain before
an exam, DoNext can continue preparing previously covered material and add further review capacity
after later lectures occur.

The calendar label remains generic, such as `CSC 370 · Midterm prep`. DoNext does not need to invent
or expose artificial phases such as orient, draft, practice, or final review.

## Effort estimates

### Assignments

Every assignment begins with a 2.5-hour effort estimate. DoNext does not interrupt the student during
plan generation to request a custom assignment estimate.

The estimate covers the complete assignment lifecycle, including final review and submission. DoNext
must not add a separate percentage or extra review duration on top of it.

Later, the daily completion system may learn course-specific effort patterns. For example, it may
learn that a particular student normally needs more time for database assignments than for HCI
assignments. Learned course-specific estimates replace the generic default in future plans when the
evidence is strong enough and the change is explained.

### Midterms and finals

Midterm and final preparation does not enter the exact plan until the exam is inside the rolling
14-day horizon.

When an exam first enters that horizon, DoNext asks the student for the approximate total preparation
time required. If the student skips the question, DoNext uses a clearly identified eight-hour default.
The value is an estimate, not a course requirement.

Final exams use the same 14-day activation rule as midterms.

### Quizzes

Quizzes use a two-hour preparation default. They do not require the same preparation-hours prompt as
midterms and finals.

## Assignment scheduling

### Front-load actionable work

Once an assignment becomes actionable, DoNext places it into the earliest reasonable openings. It
does not spread work evenly merely to make the calendar look balanced.

Starting early is valuable because it:

- reduces deadline risk;
- exposes underestimated work while recovery is still possible;
- prevents later academic pressure from displacing personal goals; and
- creates room for exam preparation when an exam approaches.

DoNext aims to complete an assignment at least 24 hours before its confirmed deadline whenever
capacity permits.

### Work beyond the current horizon

An actionable assignment due more than 14 days away may use otherwise-unused focus capacity in the
current plan. Distant work should not normally remove flexible personal goals from the current plan.
It fills spare capacity after nearer academic priorities and the normal plan have been covered.

### Multiple sessions

DoNext may schedule multiple blocks for the same assignment on one day when time permits or when
future capacity is tight.

It must not make an individual session longer merely because the deadline is risky. It creates
additional blocks at the student's normal session length and preserves the required break between
them.

## Exam scheduling

### Relationship between assignments and an approaching exam

When a course's midterm or final enters the 14-day horizon:

1. Same-course assignments due before the exam receive an academic priority boost.
2. Those assignments are front-loaded toward completion.
3. Exam preparation begins when reasonable capacity remains.
4. Assignments from other courses continue in parallel according to their own deadline risk,
   remaining effort, and grade weight.

An assignment from the exam's course that is due after the exam is not scheduled ahead of required
exam preparation. It can re-enter the plan only after the student has indicated that the required
exam preparation is complete and usable capacity remains.

### Continuous preparation

Once an exam is inside the 14-day horizon, preparation should maintain momentum on days with
reasonable academic capacity. DoNext should not use an artificial weekly allocation such as two
hours in the first week and six in the second.

While urgent pre-exam assignments are still underway, early review is a soft preference: aim for a
30-to-45-minute preparation block approximately every three days when capacity permits. Omit that
block when urgent assignment work consumes the student's safe capacity.

As pre-exam assignments finish or the exam gets closer, the remaining preparation estimate drives
more frequent blocks. The system continuously recalculates how much preparation remains and how much
reasonable capacity exists before the exam.

### Multiple exams

When two or more exams fall inside the same horizon, DoNext prepares for them simultaneously. It
does not finish all preparation for one exam before starting the next.

Capacity is shared using each exam's date, remaining preparation hours, grade weight, and feasibility.

## Academic priority and risk

DoNext must not use deadline order alone. It evaluates whether each item can still finish on time.
The central risk concept is remaining slack: usable capacity before the target completion time minus
the work that still must be completed.

A ten-hour assignment due in four days can require action before a one-hour assignment due in two
days if delaying the larger assignment would make it impossible. The scheduler can place work for
both rather than pretending one global sort order resolves every conflict.

### Priority rules

The following rules govern academic allocation:

1. Overdue assignments receive the highest academic urgency.
2. Among overdue assignments, higher grade weight comes first; equal-weight ties use the oldest
   missed deadline.
3. Assignments due within 48 hours receive an urgent-deadline boost.
4. When an exam is inside the horizon, same-course assignments due before that exam receive an
   exam-readiness boost.
5. Within the remaining work, lower slack, earlier deadline, more work remaining, and higher grade
   weight increase priority.
6. When two assignments have similar deadlines, the higher-weight assignment comes first.
7. When weight is unknown, DoNext uses deadline and feasibility and does not invent a value.
8. Work from other courses may proceed in parallel with exam preparation; allocation follows
   deadline risk, remaining effort, and grade weight rather than guaranteeing every item a daily
   block.

These rules are lexicographic guardrails and feasibility signals, not opaque user-facing scores.
Every consequential choice must be explainable in plain language.

## Energy-aware placement

When deadlines permit:

- demanding assignment work and practice-heavy exam work prefer high-energy availability;
- reading and light review prefer lower-energy availability; and
- ordinary work prefers medium-energy availability.

Energy matching is a soft preference. An urgent or infeasible deadline may override it, but the
deadline cannot override fixed commitments, required breaks, or minimum sleep.

## Capacity and sacrifice order

### Fixed boundaries

Classes, work, appointments, locked blocks, commute buffers, and other fixed commitments do not move
to make academic work fit.

Required breaks remain intact. DoNext creates multiple normal-length sessions instead of eliminating
breaks or silently creating marathon sessions.

### Rollover buffer

DoNext preserves one hour of intentionally unallocated capacity per day when possible. This is not a
normal task block; it is capacity held back for work that rolls over or takes longer than expected.

The buffer may be consumed automatically by overdue work or an assignment due within 48 hours.

### Flexible personal goals

When work inside the current horizon creates academic pressure, flexible personal goals are reduced
before required academic work. Academic work should not be dropped merely to preserve a flexible
goal.

This sacrifice rule does not apply to distant assignments using spare capacity: an assignment due
more than 14 days away should normally use only otherwise-unused capacity and should not displace the
student's current personal goals.

### Extra focus time

The student's preferred daily focus limit is a planning boundary, not unlimited capacity. If required
academic work still cannot fit after flexible goals and normally usable capacity are exhausted,
DoNext asks the student for explicit permission before increasing focus time.

The request must state how much extra focus time is needed and what risk it resolves. Extra focus
time may use only waking, otherwise-available time; it must not reduce sleep implicitly.

### Sleep fallback

If academic pressure remains after the extra-focus decision, DoNext may reduce sleep from the
preferred amount toward the student's configured minimum.

- DoNext informs the student; it does not need a second permission step.
- Sleep never falls below the student-specified minimum.
- The proposal explains which days use reduced sleep and why.

### Capacity escalation order

When important academic work does not fit, DoNext uses this order:

1. Use normal focus capacity.
2. Consume the rollover buffer for overdue or 48-hour urgent work.
3. Reduce or remove flexible personal goals inside the current horizon.
4. Ask permission to use additional waking focus time without reducing sleep.
5. If still necessary, reduce preferred sleep toward the student's minimum and inform them.
6. If the plan remains infeasible, leave the least-important academic work unresolved.

## Honest infeasibility

Even aggressive capacity recovery cannot guarantee that every data set is feasible. A student may,
for example, enter ten hours of work due tomorrow while fixed commitments and minimum sleep leave
only four usable hours.

DoNext must never overlap commitments, cross a deadline, remove required breaks, or go below minimum
sleep merely to claim that everything fits.

When academic work must be left unresolved, sacrifice priority is:

1. optional before required;
2. lower grade weight before higher grade weight;
3. later deadline before earlier deadline; and
4. work unrelated to an approaching exam before work that directly reduces exam risk.

The item is not deleted. It remains visible with the exact unscheduled duration, the deadline at
risk, the constraints that prevented placement, and the capacity change that would be required to
fit it.

## Schedule-proposal lifecycle

Every generated schedule is a proposal.

- Generation and regeneration never mutate the accepted schedule.
- The student can review and edit the complete proposal.
- Placement reasons, warnings, reduced personal goals, extra focus permission, sleep reductions,
  and unresolved work are visible before acceptance.
- Acceptance requires an explicit confirmation and transactionally supersedes the prior accepted
  version.
- Rejection leaves the accepted version unchanged.
- If relevant inputs change after generation, the proposal becomes stale and must be regenerated
  before acceptance.
- Automatic acceptance is not allowed.

The accepted Today, Week, and Semester views do not present a pending draft as active work.

## Explainability requirements

Every generated academic block should be able to explain:

- why the work is ready;
- why it is being worked on now;
- its deadline and remaining work;
- whether an approaching exam affected its priority;
- whether grade weight affected a tie;
- whether the chosen time matches the student's energy preference;
- whether the session used rollover, extra-focus, or reduced-sleep capacity; and
- what alternative work lost capacity as a result.

Every proposal summary should show:

- requested and scheduled academic time;
- exam-preparation estimates and remaining preparation time;
- flexible goals reduced or omitted;
- rollover buffer retained or consumed;
- days exceeding the preferred focus limit, after permission;
- days below preferred sleep but at or above minimum sleep; and
- all unresolved work and reasons.

## Deterministic and AI responsibilities

The behavioral rules in this document must work without an AI provider.

Deterministic, validated application code owns:

- readiness gates;
- deadline and grade-weight truth;
- effort accounting;
- priority guardrails;
- capacity and constraint calculations;
- exact dates, times, and durations;
- conflict and infeasibility detection;
- proposal versioning; and
- acceptance.

An optional AI model may interpret student feedback or help classify a constrained preference, but it
must not invent activities, deadlines, weights, course content, or available capacity. It cannot move
fixed commitments, override hard boundaries, choose an unvalidated exact block, or accept a proposal.

AI-generated academic phases are not part of the canonical experience. Exam blocks use generic prep
labels, and assignment blocks use the confirmed assignment identity.

## Future adaptive completion loop

Daily completion check-ins are a related future capability, not part of the initial scheduling rules
defined above.

The agreed high-level direction is:

- after accepting a plan, the student reports what was actually completed;
- unfinished academic work remains outstanding rather than disappearing;
- upcoming plans are recalculated from actual remaining work;
- observed completion patterns can improve course-specific effort estimates; and
- recalculation produces a new reviewable proposal rather than silently rewriting accepted history.

The check-in states, completion accounting, confidence threshold for learned estimates, and detailed
replanning workflow require their own specification before implementation.

## Acceptance scenarios

The scheduling behavior is not complete until automated tests cover at least these scenarios:

1. An assignment is not scheduled before the first lecture and is front-loaded afterward.
2. A same-course assignment due before a midterm receives a boost when the midterm enters the
   horizon.
3. An assignment due within 48 hours can override that exam-related boost.
4. A long assignment starts early when delaying it would make its deadline infeasible.
5. Higher grade weight breaks a similar-deadline tie; unknown weight falls back to deadline risk.
6. An assignment due beyond 14 days uses spare capacity without displacing a flexible personal goal.
7. Midterm and final preparation prompts for hours inside the horizon and falls back to eight hours.
8. Quiz preparation uses the two-hour default.
9. Two overlapping exams receive simultaneous preparation.
10. Post-exam assignments from the same course wait until required prep is actually complete.
11. Multiple same-day blocks retain normal session length and required breaks.
12. The one-hour buffer remains unused under normal load and is consumed by overdue or 48-hour work.
13. Flexible goals yield before required academics.
14. Extra focus capacity is never used without permission and never silently reduces sleep.
15. Preferred sleep may reduce to the configured minimum with a visible explanation.
16. An impossible plan drops the least-important academic item and reports the exact shortfall.
17. A generated or recalculated proposal never changes the accepted schedule before confirmation.
