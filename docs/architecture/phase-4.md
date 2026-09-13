# DoNext daily completion loop and Today redesign

Author: Nikhil Dhillon

Status: Implementation plan

Phase 2 implemented on 2026-09-13: day and week planning responses expose block check-ins,
the active timer, actual logged minutes, estimate overruns, unanswered past blocks, and outstanding
minutes for tasks with past focus blocks. Completed tasks remain in a separate list for the stored
local date of their deciding finished session; they do not return to deadlines or unscheduled work.
Block state matches by fingerprint across schedule copies, and capacity fields remain unchanged.
The default day and week endpoints now use the shared clock. Seven planning regression tests were
added, and the existing next-entry test now fixes its clock rather than depending on today's date.

Validation: all 40 planning/completion tests pass, as do web lint/typecheck, API lint/typecheck,
and the production web build (with network access for the existing Geist Google font).
The full API run has 178 passing tests and 14 failures, all present in the captured baseline
(which had 15 failures before fixing the planning test's clock). The quality gate remains blocked
by those pre-existing proposal and student-scheduling failures; the older two-failure count below
is not the current baseline.

## Document boundary

This document plans work that is not yet implemented. The canonical product policy remains
[`../scheduling.md`](../scheduling.md), and [`phase-3.md`](phase-3.md) records what the repository
currently does. Phase 0 below moves the rules stated here into `scheduling.md`, after which that
document governs and this one becomes a build order.

## Why

`/today` is the first navigation item and the page a student would live in, but it is an intake
surface wearing an execution surface's clothes. Nothing a student does during the day reaches the
scheduler, so the plan drifts from reality the moment the day starts.

Four concrete failures:

1. **Nothing is completable.** Agenda rows in "Today's plan" carry an edit pencil and nothing else
   (`apps/web/src/components/today-planner.tsx:170-184`). There is no way to say "I did this".
2. **The one checkbox is lossy.** The `.check-ring` on Unscheduled work calls
   `POST /tasks/{id}/complete`, which sets `status=completed, remaining_minutes=0` and nothing else
   (`apps/api/src/donext/routers/tasks.py:175-182`). No confirmation, no undo, no record of how long
   the work took.
3. **No time is ever recorded.** Nothing in the repository stores actual, logged, spent, or elapsed
   time. `remaining_minutes` moves only by explicit edit, so a plan cannot be recalculated from what
   really happened and effort estimates can never improve.
4. **The page contradicts the specification.** It shows "Room to breathe · 0% of usable focus time
   planned" while three assignments sit unbooked, though `../scheduling.md:161` requires that a day
   holding an unbooked deadline is never presented as an unencumbered day.

`../scheduling.md:512-526` already defines a "Future adaptive completion loop" and states that its
check-in states, completion accounting, confidence threshold, and replanning workflow require their
own specification before implementation. `phase-3.md:193` lists daily check-ins, partial block
completion, and learned estimates as out of scope. This plan writes that specification and then
implements it.

**Intended outcome:** a student ticks off work as the day goes, says how long it actually took, and
DoNext reschedules what is left and gets better at estimating their courses, with the accepted
schedule never rewritten without their confirmation.

## Product decisions

| Question | Decision |
|---|---|
| Leftover work | Into free capacity if any exists; otherwise displace lower-priority work and present a reviewable draft |
| Time entry | Both a one-tap confirm prefilled with the planned duration and a start/stop timer |
| Learned estimates | Suggest a larger figure at intake, which the student confirms. A stated estimate always wins |
| Delivery | Phased, specification first |

## Design constraints

These are load-bearing. Ignoring any of them produces a broken implementation.

- **Completion records must not live on `scheduled_blocks`.** `_copy_preserved_blocks`
  (`apps/api/src/donext/routers/proposals.py:1578`) copies accepted blocks into each new
  `ScheduleVersion` as new rows, so block identifiers do not survive regeneration and a check-off
  keyed to one would be destroyed by the next accepted plan. Sessions anchor on `task_id` and
  identify a block by a hash of `(task_id, start_at, end_at)`, which the copy preserves verbatim.
  The block identifier itself is provenance only.
- **A past accepted block already counts as work done**, implicitly, through `preserved_minutes`
  (`proposals.py:2528`). Reducing `remaining_minutes` without correcting that subtracts the same
  minutes twice and deletes the work. See "The double-subtraction defect" below; it is the highest
  risk in this plan.
- **`remaining_minutes` is already the scheduling source of truth** (`phase-3.md:48`, consumed at
  `proposals.py:2684` as `target = remaining_minutes - preserved_minutes`). Logging time decrements
  it and the existing solver reschedules the remainder without new placement code.
- **`direct-placement` is the precedent for the free-capacity path.**
  `POST /semesters/{id}/schedule/direct-placement` (`proposals.py:428`) already solves one task
  against capacity the accepted plan is not using, commits add-only blocks, and reports an undoable
  result. The displacement path is an ordinary `_build_proposal` call, because the solver's
  lexicographic priority bands already demote lower-priority work.
- **Completed tasks vanish from the day view.** `build_planning_view`
  (`apps/api/src/donext/planning.py:297`) filters to
  `status IN (pending, in_progress) AND remaining_minutes > 0`, so there is no "done today" list to
  render.
- **`TaskStatus.in_progress` is declared, queried, and never assigned anywhere in `src/`.** It is a
  dead state this work gives meaning.
- **Styling is hand-written semantic CSS**, one `globals.css` with tokens at `:root` (`--ink`,
  `--paper`, `--surface`, `--line`, `--accent`, plus the `--focus-*`, `--class-*` and `--personal-*`
  category quads). Tailwind is imported but only three utilities are used across the application,
  and there is no component library. Reusable primitives: `.check-ring` (`globals.css:143`),
  `.checkbox-field` (`:433`), `.primary-button`, `.secondary-button`, `.text-button`,
  `.icon-button`, `.status-pill`, `.progress-track` (`:411`), the `.intake-hours` input-and-unit
  pattern (`apps/web/src/components/work-intake.tsx:277-287`), and `FormDialog`.
- **Mobile hides `.today-heading .heading-actions`** (`globals.css:838`), so any new header control
  needs a home at 390 pixels.
- Cross-surface refresh is a global event:
  `window.dispatchEvent(new Event("donext:planning-updated"))`.

---

# Part 1 — The page redesign

## Diagnosis

| Problem | Evidence |
|---|---|
| Intake owns the top third of the page | `WorkIntake` renders above everything (`today-planner.tsx:106-113`); three activation rows push the day's actual plan below the fold |
| The same work is listed twice | Assignments appear as activation prompts and again under "Unscheduled work" |
| The capacity pill overstates calm | `capacityStatus()` (`today-planner.tsx:284`) reads only `remaining_focus_minutes`, so unbooked deadlines cannot reach it |
| "Do next" surfaces a commitment | `next_entry_id` is the first entry ending after now (`planning.py:470`), so an eight-hour shift becomes the hero card |
| Logging effort has no visible payoff | Nothing on the page shows accumulated progress toward finishing an assignment |

## Reframe

Today does three jobs, in this order: **act now, record what happened, decide what needs me.**
Intake is the third job, not the first.

## Target layout

```
┌──────────────────────────────────────────────────────────────────┐
│ SUNDAY, SEPTEMBER 13                                             │
│ Good afternoon, Nikhil.                      [View week] [+ Block]│
│ 2 of 4 done · 1h 30m logged · 3 deadlines with no time booked    │
└──────────────────────────────────────────────────────────────────┘

┌──── RIGHT NOW ──────────────────────────────┬──── TODAY ─────────┐
│ ▶ CSC 349A · Assignment 1                   │  ●●●○   2 of 4     │
│   00:42:17 of 1h 30m       [Pause] [Done ✓] │  1h 30m logged     │
│   ───────────────────────────────────────   │  ▓▓▓▓▓░░░  38%     │
│   Inside Popeyes until 6:00 PM              │  2h 30m still open │
└─────────────────────────────────────────────┴────────────────────┘

┌─── Today's plan ─────────────────────────────────  [Add block] ──┐
│  ✓   10 AM   Popeyes                     Work · Weekly      8h   │
│  ✓    6 PM   Gym                         Personal           1h   │
│  ▶    7 PM   CSC 349A · Assignment 1     running 00:42   1h 30m  │
│  ○    9 PM   SENG 310 · Assignment 1     Focus              1h   │
└──────────────────────────────────────────────────────────────────┘

┌─── Work in progress ──────────────────┬─── Needs your call ──────┐
│ CSC 349A · Assignment 1               │ 3 deadlines are in view  │
│ ▓▓▓▓▓░░░░  1h 30m of 2h 30m · Sep 19  │ with no time booked.     │
│ SENG 310 · Assignment 1               │ Sep 19 · Sep 22 · Sep 26 │
│ ░░░░░░░░░  none yet of 2h 30m · Sep 22│ [Tell DoNext what's out] │
└───────────────────────────────────────┴──────────────────────────┘
```

## Region by region

**1. Header.** Keep the greeting. Replace `todaySummary()` (`today-planner.tsx:291`) with a line
that leads with progress and names unbooked pressure: `2 of 4 done · 1h 30m logged · 3 deadlines
with no time booked`. Open capacity is never claimed without naming unbooked deadlines in the same
sentence.

**2. "Right now"**, replacing the `.next-card` "Do next" hero. The timer lives here.

- A live focus block shows running elapsed time, `Pause`, and `Done`.
- Inside a fixed commitment, the commitment is named as context on a second line and the next focus
  block is still surfaced, so an eight-hour shift never becomes the only thing the hero says.
- With nothing scheduled, the existing empty variant plus the highest-priority unbooked deadline.
- The dark `--ink` treatment (`globals.css:127-131`) is kept so the hero still reads as the hero.

**3. Today counter.** Blocks done against total, minutes logged, and the percentage of today's
planned focus actually worked. This is the payoff that makes logging worth doing. It replaces the
low-value `.insight-card`, whose warning text folds into the capacity card.

**4. Today's plan becomes a checklist.** Each `.agenda-row` gains a leading control, at least 44
pixels on touch:

| State | Control | Meaning |
|---|---|---|
| Upcoming | open ring | not started |
| Live | play / pause | timer running or paused |
| Logged, unfinished | half ring plus `1h 30m logged` | partly done |
| Logged, finished | filled check | complete |
| Past, unanswered | open ring with a quiet accent edge | needs a close-out answer |
| Fixed commitment or class | no control; dims once past | see below |

**What is tickable.** A `ScheduledBlock` carries `task_id`, `goal_id`, or `fixed_event_id`
(`apps/api/src/donext/models.py:682-690`), and only the first two have anything to record against:

- **`task_id`** produces a full work session. Academic effort, the case this plan is about.
- **`goal_id`** produces a session as well, but it advances `Goal.current_progress`, which already
  exists (`models.py:448`) and already renders as the `.goal-orb` conic ring in
  `commitments-panel`. Ticking a gym block should move that ring. `work_sessions` therefore allows
  `task_id` exclusive-or `goal_id`, and goal sessions skip the remaining-minutes accounting
  entirely.
- **`fixed_event_id`** — a shift or a lecture — is **not tickable**. DoNext does not track
  attendance and should not imply that it does. These rows dim once past and remain as context.

Tapping the check opens a confirm popover offering `Finished it`, `Still going`, and
`Didn't get to it`, with a prefilled hours field reusing the `.intake-hours` markup. One tap plus
Enter is the common path. Rows stay editable, with the pencil moving into an overflow so the check
control owns the primary slot.

**5. Close out today.** When past blocks are unanswered, "Right now" is replaced in the evening, or
joined earlier in the day, by a compact reconcile list: every unanswered past block with the same
three-way answer and a prefilled duration, plus `Log all as planned` for the honest common case.
Ticking through the day is aspirational; the evening pass is what actually closes the loop.

**6. Work in progress.** Per activated academic item, a `.progress-track` bar of logged against
estimated, the remainder, and the deadline. The accumulating bar is the reason a student keeps
logging.

**7. Needs your call**, the demoted intake. `WorkIntake` collapses to one line when nothing is
urgent — "3 deadlines are in view with no time booked" plus the dates and a button that expands the
existing rows in place. It auto-expands when the API already flags `urgent` (`ActivationPromptRead`,
`apps/api/src/donext/schemas.py:478`). The component keeps its current internals; only its container
and default state change. This also removes the duplicate listing, because "Unscheduled work" is
reframed as activated work the plan could not fit, which is genuinely different from an unactivated
deadline.

**8. Honest capacity.** `capacityStatus()` gains an unbooked-deadline input so it cannot return
"Room to breathe" while deadlines carry no time. A new band, "Deadlines without time", uses the
existing `--warn-*` tokens.

## Files

| File | Change |
|---|---|
| `apps/web/src/components/today-planner.tsx` | Rewritten around the regions above; day-state arithmetic extracted into `lib/` helpers and regions split into components rather than growing the current 326-line file |
| `apps/web/src/components/today/*.tsx` (new) | `NowCard`, `DayChecklist` and `ChecklistRow`, `LogSessionPopover`, `CloseOutPanel`, `ProgressPanel`, `AttentionPanel` |
| `apps/web/src/components/work-intake.tsx` | Collapsed default state and `urgent` auto-expand; internals unchanged |
| `apps/web/src/app/globals.css` | Extend the Today section (lines 109-152) with checklist, timer, progress, and close-out classes, reusing existing tokens with no new palette |
| `apps/web/src/lib/types.ts` | Session and progress types mirroring the API schemas |

## Accessibility and design QA

Every visual change in this repository is held to the bar recorded in `design-qa.md`: desktop and
390-pixel passes, no horizontal overflow, `prefers-reduced-motion`, 44-pixel touch targets, state
never carried by colour alone, and a clean console. This redesign must produce its own `design-qa.md`
entry. Specifically: the timer exposes `aria-live="polite"` for elapsed time and respects reduced
motion; check state is conveyed by icon and text, not by the ring alone; the close-out list is
keyboard traversable; and logging is undoable from the status line.

---

# Part 2 — The completion loop

## The double-subtraction defect

`_scheduling_items` builds `preserved_minutes` from every preserved block, past ones included
(`proposals.py:2528-2533`), and two consumers subtract it — `proposals.py:2684` and the semester
forecast at `proposals.py:2299`:

```python
remaining = max(task.remaining_minutes - preserved_minutes.get(task.id, 0), 0)
```

That subtraction *is* the current implicit completion model: a past accepted block counts as done
precisely because `remaining_minutes` never moves on its own. The instant a work session reduces
`remaining_minutes`, the same minutes are subtracted twice and the work silently disappears from
every future plan, which is the exact failure `../scheduling.md:521` forbids.

The fix is at the dictionary construction only, so both consumers inherit it:

```
past_preserved   = sum of preserved block minutes with start_at <= planning_now
future_preserved = sum of preserved block minutes with start_at >  planning_now
credited         = future_preserved + max(past_preserved - logged_minutes(task), 0)
```

Both limit cases justify it. With no sessions, `credited` equals `past + future`, identical to
current behaviour, so no existing test moves. Fully checked in, the past contributes nothing and
`remaining_minutes` alone decides. It is monotone in between. **This ships in Phase 1, alongside
sessions, not afterwards.**

The simpler end state — dropping past preserved entirely, on the grounds that work never reported is
work still outstanding — is the right follow-up once check-ins are normal, and belongs in its own
change because it will move blocks in existing tests.

## Data model

### `work_sessions`

| Column | Type | Rationale |
|---|---|---|
| `id`, `created_at`, `updated_at` | `UuidTimestampMixin` | house style |
| `user_id` | FK users CASCADE, indexed | ownership |
| `task_id` | FK tasks CASCADE, indexed, nullable | the durable anchor; tasks survive every regeneration, acceptance, and deactivation |
| `goal_id` | FK goals CASCADE, indexed, nullable | a ticked goal block, exclusive-or with `task_id`; advances `Goal.current_progress` and skips the accounting below |
| `local_date` | Date | the student's "that day", stored rather than derived, so a later timezone edit cannot re-date past work |
| `minutes` | Integer 0-1440 | the authoritative logged amount; accounting reads only this |
| `outcome` | `WorkOutcome`: `finished`, `still_going`, `not_started` | the report, kept separate from the number |
| `source` | `WorkLogSource`: `timer`, `quick_confirm`, `manual` | which path was used |
| `started_at`, `ended_at` | DateTime(tz), nullable | real instants for a timer; a one-tap confirm has none, and inventing them would be a fabrication |
| `scheduled_block_id` | FK scheduled_blocks SET NULL, nullable | provenance only: which row was on screen, never how much is done |
| `block_fingerprint` | String(64), nullable | `sha256` over `task_id`, `start_at_utc`, `end_at_utc` |

Constraints: `minutes BETWEEN 0 AND 1440`; `outcome <> 'not_started' OR minutes = 0`;
`ended_at > started_at` when both are present; `UNIQUE(user_id, block_fingerprint)`;
indexes on `(user_id, local_date)` and `(task_id, local_date)`.

**`block_fingerprint` is the idempotency key, and it is what survives regeneration.**
`_copy_preserved_blocks` copies `task_id`, `start_at`, and `end_at` verbatim
(`proposals.py:1597-1611`), and past blocks are always preserved, so a block ticked at four o'clock
keeps its fingerprint through every later generation even though its row identifier changes. NULLs
are distinct in both SQLite and PostgreSQL, so ad-hoc logging stays unconstrained.

**`not_started` is a row, not an absence.** The page must distinguish *unanswered* — no row, so keep
prompting — from *answered: no* — a row with zero minutes, settled, and rolled over.

### `work_timers`

`user_id` (UNIQUE), `task_id`, `started_at`, `scheduled_block_id`, `block_fingerprint`.

A running timer is intent, not evidence: it has no minutes and no outcome. Keeping it inside
`work_sessions` would force both columns nullable for a transient state and would make every
accounting query filter out a row that is not evidence yet, which is the kind of filter that gets
forgotten once. `UNIQUE(user_id)` expresses "one timer at a time" with no partial index and no
dialect branch.

**The timer must never write to `Task`.** `input_fingerprint` hashes every Task column
(`proposals.py:1476-1485`), so flipping `status` on timer start would make the student's open draft
stale merely because they pressed play.

### What is deliberately absent

**No `tasks.activated_estimate_minutes`.** `input_fingerprint` iterates `Task.__table__.columns`, so
every new Task column joins the generation fingerprint permanently. The activation snapshot belongs
in `effort_observations` instead.

### Migrations

`e4b17c9a2f50_add_work_sessions.py` with `down_revision = "c1b8e5d47a63"`, the current head, and
`f9a3d6021c74_add_effort_observations.py` chained after it. No backfill: work completed through the
old endpoint has no logged time and is correctly excluded from learning. Inventing sessions for it
would fabricate evidence.

### `in_progress` gains meaning

*This task has logged work and is not finished.* Set only by the recomputation below, never by the
timer and never directly. It requires no query changes, because `pending, in_progress` is already
the filter at `planning.py:322` and `proposals.py:2523`.

## Completion accounting

All arithmetic lives in one module, `apps/api/src/donext/completion.py`. No router touches
`remaining_minutes`.

**Recompute, never patch.** Every write path — create, edit, delete, timer stop, `/complete`, and
the resizes in `grading.py` — calls one function:

```python
def apply_completion_state(db: Session, task: Task) -> None:
    """Recompute remaining work and status from the task's full session set."""
```

Incremental adjustment is not available, because the overrun rule below is not associative: deleting
a mistyped 400-minute session cannot be undone by adding 400 back.

With `logged` as the sum of session minutes, `E` as `task.estimated_minutes`, `P` as
`task.preferred_session_minutes`, and `finished` meaning that the latest session ordered by
`(local_date, created_at)` whose outcome is `finished` or `still_going` is `finished`
(`not_started` rows never decide):

```
remaining_minutes = 0                    if finished
                  = max(E - logged, 0)   if not finished and logged <  E
                  = P                    if not finished and logged >= E

status            = completed   if finished
                  = in_progress if logged > 0
                  = pending     otherwise
```

**`estimated_minutes` and `estimate_origin` are never written by a check-in.** This matters three
ways: recomputation stays idempotent under edit and delete; the learner cannot train on its own
corrections, so no defensive second column is needed; and `student_provided` remains a true fact
about what the student said, where overwriting their provenance would contradict the rule that a
stated figure is authoritative (`../scheduling.md:183-186`).

Two numbers stay honestly distinct, and the specification must name both: *estimate consumed* is
`E - remaining_minutes`, progress against the plan of record, which is already what `grading.py:603`
means by `done`; *actual logged* is the sum of session minutes.

### The overrun case

Clamping to zero is not available, because `_scheduling_items` keeps only `remaining_minutes > 0`
(`proposals.py:2523`), so a zeroed remainder makes unfinished work vanish.

**Rule: `remaining_minutes = preferred_session_minutes`**, a standing one-session placeholder
recomputed identically every time. A percentage markup would be an invented number, which
`../scheduling.md:96-98` forbids. One preferred session is the exact quantum `session_durations`
places, it keeps the work visible and schedulable, and it re-asks the question at the next check-in
instead of pretending to know the answer.

The known-wrong condition is derived, not stored:
`estimate_exceeded = logged >= estimated_minutes and status != completed`, surfaced on
`PlanningTaskRead` and driving the warning copy.

### Finishing early releases future blocks

Call `release_future_accepted_time`, which is the existing `_release_accepted_time`
(`apps/api/src/donext/routers/grading.py:766`) moved into `completion.py` and imported back by
`grading.py`. It already deletes accepted blocks starting after now, leaves started blocks alone,
and returns the released count and minutes. Without it, finishing early leaves phantom blocks on the
accepted calendar, because `_scheduling_items` drops completed tasks but nothing prunes the accepted
version.

### The resize sites must stop trusting `estimated - remaining`

`grading.py:603-605` and `grading.py:748-750` compute `done = estimated - remaining`. After the
overrun rule that understates the work by `logged - E + P`. One helper fixes both:

```python
def minutes_done(db: Session, task: Task) -> int:
    logged = db.scalar(select(func.coalesce(func.sum(WorkSession.minutes), 0))
                       .where(WorkSession.task_id == task.id)) or 0
    return max(logged, max(task.estimated_minutes - task.remaining_minutes, 0))
```

The outer `max` keeps legacy tasks behaving exactly as today, which is why `test_grading.py` stays
green without edits.

### Idempotency

`POST /work-sessions` carrying an existing `block_fingerprint` updates that row and returns `200`
with `created: false`; a new fingerprint returns `201`. A double tap and a correction become the
same operation, which is what a one-tap surface needs.

## Rollover

```
POST /semesters/{semester_id}/schedule/rollover   ->  RolloverRead

1. Determine the local day being closed out (default today; never a future date).
2. Roll set = tasks with remaining_minutes > 0 that had an accepted focus block starting
   that day which has already passed.
3. Branch A: solve all roll-set tasks together against capacity the accepted plan is not
   already using. If every required minute fits, commit add-only blocks.
4. Branch B: otherwise commit nothing and return _build_proposal() as a draft.
```

**One solve with N items, not N calls.** Separate calls each build windows from the same accepted
exclusions and would double-book each other, and committing between calls breaks the all-or-nothing
guarantee.

Branch A extracts the body of `place_activated_work` (`proposals.py:432-588`) into
`_place_into_free_capacity(db, user, semester, tasks, *, source, reason_code, message)`, leaving
`place_activated_work` as a one-task caller. `test_student_scheduling.py:213-261` passing unchanged
is the extraction's regression guard.

Everything that makes the path honest carries over structurally. Accepted blocks are exclusions in
`_scheduling_windows` (`proposals.py:1651-1654`), so nothing moves. `not_before = planning_now`
(`proposals.py:520-530`) makes the past untouchable. No `release_buffer` is passed, so
`usable_focus_capacity` still holds back the protected hour and acceptance scenario 17 is
unaffected.

> **Rollover blocks use `source="generated"` with `reason_code="ROLLOVER"`, never a new source
> string.** `_copy_preserved_blocks` re-plans only `source == "generated"`
> (`proposals.py:1590-1596`), so any other value pins the block permanently and every future
> regeneration copies it forward untouched. Rolled-over work is ordinary academic work and must stay
> movable. Provenance belongs in `reason_code`, which is what the explainability requirement
> (`../scheduling.md:466-477`) actually asks for.

Undo needs no new endpoint: `DELETE /schedule-blocks/{id}`
(`apps/api/src/donext/routers/schedules.py:206`) against the blocks the response reports, which is
the pattern acceptance scenario 6 already tests.

Branch B is `_build_proposal(...)` plus a commit. `_copy_preserved_blocks` drops every unlocked
generated in-horizon block starting after `freeze_until` and preserves the rest, so the past and the
day just closed out are untouched while the remaining future is re-solved as one problem.
`_scheduling_items` reads `task.remaining_minutes` fresh, so rolled-over minutes enter as ordinary
demand, and the lexicographic bands demote flexible goals first, then optional academics, then by
slack and urgency, with `attach_displacement` restating the trade-off truthfully. The result carries
`status = proposed`; `accept_proposal` remains the only thing that can make it real.

`SCHEDULER_EXTRA_FOCUS_PERMISSION_REQUIRED` (409) propagates unchanged. It already rolls back before
raising, so nothing is half-written and the existing permission interface handles it verbatim.

`dry_run: true` lets the page show which branch will be taken before anything is committed;
`draft_required` is the dry-run form of Branch B.

### Why this cannot rewrite accepted history

Branch A is add-only by construction and is the path `../scheduling.md:451-464` already blesses.
Branch B produces a proposed version and returns it. Neither branch deletes or moves an accepted
block. Meanwhile `input_fingerprint` (`proposals.py:1472`) hashes every Task column and every
accepted block's identifier and times, so a check-in or a Branch A commit makes any open draft
stale and `accept_proposal` (`proposals.py:1226-1232`) refuses it with `PROPOSAL_STALE`. Acceptance
scenario 22 holds without new locking.

## Learned estimates

### `effort_observations`, stored and written in two phases

| Column | Rationale |
|---|---|
| `user_id`, `task_id` (UNIQUE) | one observation per task |
| `course_id`, `item_type` | snapshots, because both are mutable on the live rows |
| `estimated_minutes`, `estimate_origin` | the figure the student stood behind at activation |
| `actual_minutes`, `completed_on`, `excluded_reason` | filled when status becomes `completed` |

Stored rather than computed on read, because `tasks.estimated_minutes` is rewritten by both
`grading.py:729` and `grading.py:603`, so a read-time ratio would measure against a number that did
not exist when the work started. The row is created at activation and completed by
`apply_completion_state`. Re-activation after deactivation overwrites it, which is correct: that is
a fresh commitment.

### Grouping, statistic, threshold

- **Grouping chain:** `(course_id, item_type)`, then `(item_type)` across courses, then nothing.
  There is deliberately no `(course, any type)` level, because an exam and an assignment in the same
  course say nothing about each other. The specific group is thin early in a semester, so it must
  degrade rather than stay silent.
- **Statistic:** the median of `actual / estimate`. Not the mean, because n is three to six and one
  all-nighter drags a mean badly while a median needs no tuning constant. Trim only when there is
  something to trim: at n of six or more, drop one high and one low first.
- **Threshold:** three included observations at the level in use. Two is a coincidence; three is the
  smallest n whose median is not merely one of two points. Being early costs a prompt the student
  overrides, never a wrong plan, because nothing is applied without confirmation.
- **Only larger suggestions.** A median ratio at or below 1.0 produces nothing.
  `suggested = round_to_5(base * ratio)`, clamped to the existing `ge=15, le=10080, multiple_of=5`
  and returned only when strictly greater than the base.
- **Exclusions**, written into `excluded_reason` at completion: `fallback_estimate` when the origin
  is not `student_provided`, since learning from DoNext's own 150-minute default teaches DoNext
  about itself; `no_time_logged` when nothing was logged, which covers every legacy completion;
  and `not_checked_in` when the work was completed without a deciding `finished` outcome, which is
  abandonment rather than observation. Ratios outside `[0.25, 4.0]` are dropped at read time as
  mistyped entries or fundamentally different work.

### Where it surfaces

`ActivationPromptRead` (`schemas.py:478`) gains four defaulted fields — `suggested_minutes`,
`suggestion_basis`, `suggestion_sample_size`, and `suggestion_explanation` — populated in
`activation_queue` (`proposals.py:327`).

`planning.academic_effort_default` (`planning.py:68`) keeps its exact signature and stays free of
database access. It is called from `grading.py:659`, `grading.py:735`, `proposals.py:394`, and
inside `_semester_pressure_forecast`, which must stay cheap and deterministic. The fallback is what
DoNext knows; a suggestion is what DoNext offers. They are different things and belong in different
functions.

In `activate_academic_item`, the `decision == "student"` branch is untouched. It never consults the
suggestion, and that is the structural guarantee that a stated figure always wins. Only
`use_default` resolves to `learned_effort_suggestion(...).minutes or fallback_minutes`, still
recording `system_default`, because it is still not the student's own figure. No new literal is
added to `AcademicActivationUpdate`: tapping a button labelled with the suggested number is the
confirmation, and `effort_observations` already records the distinction.

A read-only `GET /courses/{id}/effort-calibration` makes the suggestion inspectable, because
`../scheduling.md:334` requires every consequential choice to be explainable in plain language.

## API surface

New router `apps/api/src/donext/routers/completion.py` with no prefix, following `proposals.py:89`,
tagged `completion`, registered in `main.py` after `planning.router`.

| Method and path | Response | Errors |
|---|---|---|
| `POST /work-sessions` | `WorkSessionRead`, 201 new or 200 updated by fingerprint | `NOT_FOUND` 404; `VALIDATION_ERROR` 422 for a future `local_date`, a block whose `task_id` differs from the payload's, or an outcome and minutes mismatch |
| `PATCH /work-sessions/{id}` | `WorkSessionRead` 200 | `NOT_FOUND` 404, `VALIDATION_ERROR` 422 |
| `DELETE /work-sessions/{id}` | 204 | `NOT_FOUND` 404 |
| `GET /work-sessions?date=` | `list[WorkSessionRead]` | — |
| `POST /work-timer` | `WorkTimerRead` 201 | `NOT_FOUND` 404; `TIMER_ALREADY_RUNNING` 409 with `details.timer` |
| `GET /work-timer` | `WorkTimerRead` or null | — |
| `DELETE /work-timer` | 204, discard without logging | `NOT_FOUND` 404 |
| `POST /work-timer/stop` | `WorkSessionRead` 200 | `NOT_FOUND` 404 when none is running; `VALIDATION_ERROR` 422 |
| `POST /semesters/{id}/schedule/rollover` | `RolloverRead` 200 | `NOT_FOUND` 404; `VALIDATION_ERROR` 422; `SCHEDULER_INPUT_INCOMPLETE` 422 and `SCHEDULER_EXTRA_FOCUS_PERMISSION_REQUIRED` 409 propagated |
| `GET /courses/{id}/effort-calibration` | `list[EffortCalibrationRead]` | `NOT_FOUND` 404 |

A single `POST /work-sessions` accepting either `task_id` or `goal_id` is preferred over nested
per-owner routes, because fingerprint uniqueness and the update-in-place branch are one code path
either way; only the ownership check differs (`owned_task` at `tasks.py:19`, `owned_goal` in
`goals.py`).

`RolloverRead` carries `outcome` as one of `nothing_to_roll`, `placed`, `draft_required`, or
`draft_created`, plus `rolled_minutes`, `blocks` for Branch A undo, `proposal` for Branch B,
`unanswered_blocks`, `released_minutes`, and `reason`.

Changed rather than new:

| Endpoint | Change |
|---|---|
| `POST /tasks/{id}/complete` (`tasks.py:175`) | Reimplemented as one `finished` session with `minutes = remaining_minutes`; the path and `TaskRead` response are unchanged, so the existing call site and both existing tests keep working |
| `PUT /academic-items/{id}/activation` (`grading.py:729`) | `use_default` consults the suggestion and the `effort_observations` row is written |
| `GET /semesters/{id}/activation-queue` | Four additive optional fields |
| `PATCH /academic-items/{id}` (`grading.py:603`) | Uses `minutes_done`, then `apply_completion_state` |

## Day-view changes

- `PlanningEntryRead` gains `block_fingerprint`, `planned_minutes`, `logged_minutes`,
  `check_in_outcome` (null meaning unanswered, not "did nothing"), `work_session_id`, and
  `timer_running`.
- `PlanningTaskRead` gains `estimated_minutes`, `logged_minutes`, and `estimate_exceeded`.
- `PlanningViewRead` gains `completed_tasks`, `logged_minutes`, `unanswered_blocks`,
  `rollover_minutes`, and `active_timer`.
- **The task filter at `planning.py:318-326` must widen.** It is
  `status IN (pending, in_progress) AND remaining_minutes > 0`, so a task vanishes from the page the
  instant it is ticked. Tasks completed today must keep rendering, or the reward for logging is
  watching the work disappear. They belong in a separate `completed_tasks` field: merging them into
  `unscheduled_tasks` or `deadlines` would break `test_planning.py:117`, which asserts that list
  exactly, and would make completed work reappear as an upcoming deadline.

All new fields carry defaults, so `SemesterPlanningRead`'s use of `build_planning_view`
(`planning.py:535`) is unaffected.

## Risks and sharp edges

- **Do not add fields to `PlanningCapacityRead`.** `test_planning.py:118-126` asserts the capacity
  dictionary with `==` against an exact literal. Every other planning assertion is field by field,
  so widening `PlanningEntryRead`, `PlanningTaskRead`, and `PlanningViewRead` is safe.
- **Two existing tests call `/tasks/{id}/complete`** — `test_api.py:386` and
  `test_student_scheduling.py:625`. The second is the post-exam gate, which reads task completion to
  re-admit same-course assignments, so the reimplemented endpoint must still land on exactly
  `status=completed, remaining_minutes=0`.
- **Timezone.** "Today" is always
  `datetime.now(UTC).astimezone(resolve_timezone(user.timezone)).date()`, the pattern at
  `planning.py:469`, `planning.py:609`, `proposals.py:244`, and `routers/planning.py:21`. Never
  `date.today()`.
- **The clock is only half testable.** Tests control time with
  `monkeypatch.setattr(proposals, "_planning_now", ...)` (`test_student_scheduling.py:696`), which
  reaches `proposals` only; `planning.py:469` and `planning.py:609` use a bare `datetime.now(UTC)`
  and cannot be patched. Add a three-line `donext/clock.py` exposing `now()`, have
  `proposals._planning_now` delegate to it so every existing monkeypatch keeps working verbatim, and
  have `completion.py` and `planning.py` call it. Note that `routers/block_placement.py:13` does
  `from donext.routers.proposals import _planning_now`, binding the function object at import, so
  that form is not affected by the existing patch; import the module and call the attribute instead.
- **Concurrency.** One running timer is `UNIQUE(user_id)` on `work_timers`; catch `IntegrityError`
  explicitly and return `TIMER_ALREADY_RUNNING` rather than falling through to the generic 409
  handler (`errors.py:48`). `apply_completion_state` must read sessions and write the task in one
  transaction, using `select(Task).with_for_update()` to match
  `_accepted_schedule(..., for_update=True)` (`proposals.py:1567`). Two devices ticking the same
  block are resolved by the fingerprint.
- **Migrations are not exercised by the test suite.** `conftest.py` builds the schema with
  `Base.metadata.create_all` rather than Alembic, so new tables appear in tests automatically and a
  broken migration would still pass. Run `pnpm migrate:api` against a real database by hand for both
  revisions. This is a standing gap worth recording in `phase-3.md`.

### Existing acceptance scenarios touched

- **Scenario 5**, deactivation retaining the estimate: sessions must survive deactivation.
  `grading.py:806` clears only `activated_at`, so this holds; add an assertion rather than code.
- **Scenario 6**, direct placement: shares the extracted helper, and its existing test passing
  unchanged is the guard.
- **Scenario 15**, the post-exam gate: `proposals.py:2676` gates on the exam task leaving
  `pending, in_progress`, which a `finished` session still achieves. Verify rather than assume.
- **Scenario 17**, the rollover buffer: the protected hour and this feature's rollover of unfinished
  work are different things sharing a word. The specification must keep them apart or it becomes
  ambiguous.

### New gaps to record in `phase-3.md`

- **Direct-placement blocks are pinned forever.** `_copy_preserved_blocks` re-plans only
  `source == "generated"` (`proposals.py:1590-1596`), so every `direct_placement` block
  (`proposals.py:571`) survives every regeneration untouched and permanently excludes its time.
  Rollover sidesteps this by using `generated`; direct placement's own behaviour needs its own fix.
- **`_copy_preserved_blocks` compares a UTC date against a local horizon.** `proposals.py:1591`
  computes `block_date` in UTC and tests it against `horizon_start` and `horizon_end`, which are
  local dates (`proposals.py:241-247`). For America/Vancouver an evening block on the last horizon
  day falls on the next UTC day and is preserved instead of re-planned. Rollover makes this visible
  because rolled work tends to land in the evening. The fix is one line, but it moves blocks in
  existing tests, so it belongs in its own change.

### Existing gaps this work sharpens

- **Post-exam assignments disappear silently** (`phase-3.md:172-174`). Partial completion makes this
  worse: a half-done exam task now stays `in_progress` indefinitely and never re-admits the
  post-exam assignment, still with no warning.
- **Distant assignments are reported as unresolved** (`phase-3.md:168-170`). Branch B regenerates,
  so every rollover draft carries those misleading `ACADEMIC_CAPACITY_LIMIT` entries and reads more
  alarming than it is.

---

# Phasing

Each phase is independently shippable, carries its own tests, and leaves `pnpm check` green.

**Phase 0 — Specification.** Replace the "Future adaptive completion loop" stub
(`../scheduling.md:512-526`) with the canonical rules: check-in states, completion accounting
including the overrun rule and the *estimate consumed* against *actual logged* distinction, the
rollover decision rule and its two branches, and the learning statistic, threshold, and exclusions.
Amend `../scheduling.md:194-197` so that a learned figure is offered at intake and becomes
authoritative only once confirmed, never silently applied. Extend the numbered acceptance scenarios
with 23 through 32 below. Update `phase-3.md`, whose "Out of scope" line 193 names exactly this work
and whose known-gaps list should carry the two new gaps above. Documentation only.

**Phase 1 — Record the work.** Migration `e4b17c9a2f50`; the `WorkSession` and `WorkTimer` models
and their enums; `donext/clock.py`; `donext/completion.py` holding `block_fingerprint`,
`logged_minutes`, `minutes_done`, `apply_completion_state`, and `release_future_accepted_time` moved
out of `grading.py:766`; the session and timer endpoints; `in_progress` given meaning; `/complete`
reimplemented; `minutes_done` wired into both resize sites; **and the double-subtraction fix**,
which ships here rather than later. Tests: `apps/api/tests/test_completion.py`.

**Phase 2 — Surface it in the day view.** The `build_planning_view` widening and the schema
additions above. Tests appended to `apps/api/tests/test_planning.py`.

**Phase 3 — Rollover.** Extract `_place_into_free_capacity` from `place_activated_work` and add the
rollover endpoint. Tests: `apps/api/tests/test_rollover.py`, with `test_student_scheduling.py:213-261`
passing unchanged as the extraction guard.

**Phase 4 — The page.** All of Part 1, against real endpoints, plus a `design-qa.md` entry with
desktop and 390-pixel passes.

**Phase 5 — Learned estimates.** Migration `f9a3d6021c74`; `donext/effort_learning.py`; the
activation and activation-queue changes; and the `work-intake.tsx` placeholder and basis line.
Tests: `apps/api/tests/test_effort_learning.py` for the pure statistic, plus an end-to-end
activation-queue case.

## New acceptance scenarios

Extending the numbered list in `../scheduling.md`, which currently ends at 22:

23. Confirming a block's planned duration reduces remaining work by exactly that amount, marks the
    task in progress, and leaves the estimate alone.
24. Starting and stopping the timer logs the measured minutes, and the figure can be corrected
    before it is saved.
25. Ticking the same block twice logs one session, not two; the second tick corrects the first
    rather than doubling it.
26. Reporting a block untouched changes no estimate and no remaining work, and leaves the work
    outstanding for rollover.
27. Logging past the estimate without finishing keeps the work visible with one further session of
    time, marks the estimate exceeded, and never drives remaining work below zero.
28. Finishing early completes the task, records the shorter actual time, and hands back the accepted
    blocks that had not yet started.
29. Editing or deleting a logged session restores the task to exactly the state its remaining
    sessions imply.
30. Leftover work lands in free capacity without moving anything already accepted and is undone in a
    single action; work that will not fit produces a reviewable draft and changes nothing until it
    is confirmed.
31. A task ticked off today still appears on today's page rather than vanishing, and does not
    reappear as an upcoming deadline or as unscheduled work.
32. After three student-estimated items of the same course and type run long, activation offers a
    larger estimate with the evidence named; a stated figure is used exactly as given, and a
    fallback estimate never becomes evidence.

---

# Verification

The standing quality gate:

```bash
pnpm check
```

It runs web lint, web typecheck, API `ruff`, `mypy --strict`, `pytest`, and the production build.

Per phase, additionally:

```bash
.venv/bin/pytest apps/api/tests/test_completion.py apps/api/tests/test_student_scheduling.py -q
```

Migrations are not covered by the suite, so apply them against a real database by hand:

```bash
pnpm migrate:api
```

End to end by hand, which is the only way to judge Phase 4:

1. Run `pnpm dev:api` and `pnpm dev:web`, sign in, and open `/today`.
2. Start the timer on a focus block, let it run, stop it, and log less than planned. Confirm that
   remaining work drops, the progress bar moves, and a rollover block appears later in the week.
3. Log a block as still going after its full estimate. Confirm the work stays visible with one
   preferred session of time, the estimate is unchanged, and the page reports the estimate as
   exceeded.
4. Fill the rest of the week, then log a partial. Confirm that nothing changes and the page offers a
   reviewable draft instead.
5. Delete the logged session. Confirm remaining work and status return exactly.
6. Complete three assignments in one course over estimate, then activate a fourth. Confirm the
   suggestion and its evidence sentence appear, and that typing a figure overrides it.
7. Check 390 pixels: touch targets of at least 44 pixels, no horizontal overflow, a clean console,
   and reduced motion honoured.

Two API tests already fail on `main` before this work and are unrelated to it —
`test_preserved_flexible_time_only_reduces_its_calendar_week` and
`test_proven_future_pressure_promotes_only_required_distant_minutes`, per `phase-3.md:204`. Capture
the baseline before starting so this work is not blamed for them. They should still fail, and no
others should.

# Out of scope

The week and semester calendars are not re-plumbed for completion state beyond what `/planning/week`
returns for free. Goal and commitment streaks, retrospective analytics, and any notification or
reminder system are separate work.
