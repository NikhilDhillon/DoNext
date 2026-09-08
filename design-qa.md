# Design QA: course-outline drop zone

## Evidence

- Source pixels: 2132 x 660.
- Desktop state: authenticated Courses empty state at a 2132 x 900 CSS viewport; the captured empty-state component measured 1224 x 500 pixels at device pixel ratio 1.
- Mobile state: authenticated Courses empty state at a 390 x 844 CSS viewport and device pixel ratio 1.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: the source is a wide content-only crop, while the implementation remains inside the existing Courses page shell. The new nested drop target intentionally adds height so file formats, limits, and the manual fallback remain visible.

The original icon, centered heading, dashed boundary, paper surface, and manual-add path remain recognizable. The single primary button is replaced by a review-first outline drop zone plus a secondary manual-entry button.

## Required fidelity surfaces

- Fonts and typography: the existing DoNext type scale, weights, and muted helper copy are reused.
- Spacing and layout rhythm: the empty state keeps its centered composition, with the new drop zone constrained to a readable 720-pixel maximum width.
- Colors and visual tokens: existing ink, mint, paper, border, and muted tokens are preserved.
- Image and icon quality: no raster or custom SVG assets were introduced; the existing Lucide book, upload, and plus icons are used.
- Copy and content: the empty state now clearly offers course-outline upload and manual entry, including supported formats and the 10 MB per-file limit.

## Interaction and accessibility checks

- The file control accepts PDF, DOCX, and TXT documents and supports multiple files.
- Semesters that already contain courses expose `Add from outline`, so a partial or later import can resume without returning to onboarding.
- Selecting the Fall 2026 CSC 370 DOCX fixture exposed the file name and enabled `Analyze document`.
- Analysis produced a seven-assessment review with a grading scheme and the explicit `Nothing is imported until you confirm` safeguard; the visual capture stopped before import.
- Three-outline regression pass: SENG 310, CSC 370, and CSC 349A produced three review cards; confirming them reduced the queue from 3 to 2 to 1 to 0 while preserving every unconfirmed review through each course-list refresh.
- The completed regression pass showed all three imported course codes in the local Flow Check Fall 2026 QA workspace.
- Dismissing review returned to the empty state without changing saved course data.
- `Enter course manually` opened the existing accessible course dialog.
- The 390-pixel layout had a 390-pixel document width, so there was no horizontal overflow.
- Browser console warnings and errors: none.

## Comparison history

1. The source established the empty-state hierarchy and manual-add affordance.
2. The implementation preserved that hierarchy and inserted the outline drop target as the primary path.
3. Desktop comparison confirmed the existing design language remains intact despite the intentional control expansion.
4. Mobile verification confirmed readable stacking, a full-width manual fallback, and no overflow.

final result: passed

---

# Design QA: reset-to-default draft action

## Evidence

- Source visual truth: `/var/folders/wf/j9x8hm7j7r7g6tffvr85bbbc0000gn/T/TemporaryItems/NSIRD_screencaptureui_Ft1fFu/Screenshot 2026-09-08 at 7.50.18 PM.png`, 712 x 218 pixels.
- Implementation: `http://localhost:3000/week`, captured in the Codex in-app browser. The browser interface rendered the evidence inline and did not expose a filesystem path.
- Desktop viewport: 1248 x 720 CSS pixels at the browser's default density.
- Narrow viewport: 740 x 900 CSS pixels at the browser's default density.
- State: authenticated Week view with an active draft, checked in the idle action state and the reset-confirmation state.
- Full-view comparison: the draft action remains in the source's top-right action group beside Adjust and Accept plan.
- Focused comparison: the source's refresh action was compared with the rendered `Reset to default` control and its inline confirmation. The control retains the same icon scale, quiet ghost treatment, spacing, and one-line desktop alignment.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: none for this scoped wording and behavior change.

## Required fidelity surfaces

- Fonts and typography: the existing button type scale, weight, line height, and compact sentence case are preserved; the longer label remains on one line at desktop width and centered on its own row at the narrow breakpoint.
- Spacing and layout rhythm: the three-action desktop grouping is unchanged. On the narrow layout, reset remains a full-width first row above Adjust and Accept plan, matching the existing responsive hierarchy.
- Colors and visual tokens: the idle action retains the muted ghost-button treatment; the destructive confirmation uses the existing warm danger-button tokens.
- Image quality and assets: no raster assets were needed. The existing Lucide refresh, check, and loader icons remain visually consistent with the source and the rest of DoNext.
- Copy and content: `New draft` is replaced by `Reset to default`. The confirmation states that added blocks and edits will be removed, and offers `Keep changes` before `Reset draft`.

## Interaction and accessibility checks

- Clicking `Reset to default` opens the inline confirmation without changing the proposal.
- Clicking `Keep changes` restores the ordinary draft actions.
- The confirmation is exposed as an alert and uses visible text rather than relying on icon or color.
- A targeted API regression test removes a generated block, adds a user block in its place, creates the clean default draft, and confirms the original generated block set is restored.
- Web lint, web TypeScript, and the targeted API regression test pass.
- The browser console showed no warnings or errors.

## Comparison history

1. The first desktop pass confirmed that `Reset to default` fits the supplied action strip without shifting Adjust or Accept plan.
2. The confirmation pass confirmed clear consequence copy and distinct keep/reset choices.
3. The 740-pixel pass confirmed the longer label and confirmation remain readable with no horizontal overflow.

final result: passed

---

# Design QA: per-day commitment times

## Evidence

- Source pixels: 1684 x 1492; the screenshot shows Monday, Tuesday, and Wednesday sharing one 10:30 AM, eight-hour schedule.
- Desktop implementation pixels: 1710 x 1102 at a 1710 x 1080 CSS viewport. The in-app browser rendered the app content at approximately 0.5 visual density, so the form region was normalized before comparison.
- Mobile implementation pixels: 390 x 844 at a 390 x 844 CSS viewport and device pixel ratio 1.
- State: Popeyes, Work, Monday/Tuesday/Wednesday selected; Monday 10:30 AM for eight hours, Tuesday 1:00 PM for four hours, Wednesday 5:30 PM for two hours.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: none for this scoped interaction change.

The selected weekday controls remain unchanged. The shared start and duration controls are intentionally replaced by a `Times by day` section that gives every selected day its own labeled time and duration controls.

## Required fidelity surfaces

- Fonts and typography: the existing DoNext font stack, weights, label hierarchy, and compact uppercase field captions are preserved.
- Spacing and layout rhythm: desktop rows align the day, start, and duration in three columns; mobile rows stack the day label over a two-column time/duration pair. The 390 px form measured 334 px wide with a 332 px scroll width, so there is no horizontal overflow.
- Colors and visual tokens: the existing paper, mint, ink, border, selected, and focus tokens are reused.
- Image and icon quality: no new image assets or custom icons were introduced; the existing Lucide controls remain unchanged.
- Copy and content: `Times by day` and `Each selected day can have its own schedule` explain the behavior directly. The repeat helper confirms that each chosen time repeats independently.

## Interaction and accessibility checks

- Selecting Monday, Tuesday, and Wednesday creates three schedule rows in weekday order.
- Each row has a uniquely named start-time textbox and duration combobox.
- Monday, Tuesday, and Wednesday accepted three different start times and three different durations simultaneously.
- Deselecting Tuesday removed only Tuesday’s schedule row and left Monday and Wednesday intact.
- Submitting with no selected days or an incomplete selected-day schedule is rejected with a clear message.
- The save path reads each selected day’s own start and duration, calculates its own end time, and creates a separate fixed event with the matching weekly recurrence day.
- Browser console warnings and errors: none.

## Comparison history

1. The source gave every selected weekday one shared start and duration, which could not represent variable work shifts or gym times.
2. The implementation introduced a selected-day schedule row for each weekday while preserving the rest of the form’s hierarchy and styling.
3. The full and focused comparisons showed the intended control expansion with no actionable P0, P1, or P2 visual issues.
4. The mobile pass confirmed readable controls, clean stacking, and no horizontal overflow.

final result: passed

---

# Design QA: flexible commitment scheduling

## Evidence

- Source pixels: 1684 x 1492.
- Desktop implementation: 1280 x 1122 pixels at the in-app browser's default desktop viewport and device pixel ratio 1.
- Mobile implementation: 390 x 844 pixels at a 390 x 844 CSS viewport and device pixel ratio 1.
- State: `Let DoNext schedule it`, `Hours per selected day`, Monday and Wednesday selected, one hour per selected day.
- Full-view comparison: the source and desktop implementation were opened together and checked for hierarchy, form density, tokens, and alignment.
- Focused comparison: the 390 x 844 mobile viewport was checked for control wrapping, sticky navigation, readability, and overflow.

## Findings

- P0: none.
- P1: none.
- P2: none remaining.
- P3: the desktop reference is a cropped content-only view, while the implementation evidence includes the existing onboarding sidebar; this is expected application chrome rather than design drift.

## Required fidelity surfaces

- Fonts and typography: the existing DoNext font stack, weights, label hierarchy, and compact helper copy are preserved. No unintended truncation remains.
- Spacing and layout rhythm: the two mode cards and two cadence cards share the existing form rhythm and collapse to one column on mobile. The mobile document measured 390 px wide with a 390 px scroll width, so there is no horizontal overflow.
- Colors and visual tokens: the existing paper, mint, ink, border, selected, focus, and informational tokens are reused.
- Image and icon quality: no raster assets were required; visible controls use the project's existing Lucide icon library and no custom SVG or placeholder art.
- Copy and content: the interface distinguishes fixed times from draft scheduling, names weekly versus selected-day targets, and states that nothing changes until the draft is accepted.

## Interaction and accessibility checks

- Manual scheduling is selected by default and retains the existing selected-day time rows.
- Switching to flexible scheduling removes the manual-only fields and reveals weekly and selected-day choices.
- Selecting the per-day option reveals an accessible weekday group; Monday and Wednesday can be selected independently.
- The time amount is a labeled number input constrained to 15-minute increments.
- Radio cards and weekday controls expose native roles, checked states, and keyboard focus styling.
- Desktop and mobile browser states rendered without console warnings or errors.

## Comparison history

1. The first desktop pass exposed a P2 wrapping problem because cadence-card copy was placed in the icon column.
2. The cadence cards were corrected to a single-column text layout.
3. The second desktop pass showed readable card titles and descriptions with the intended selected state.
4. The mobile pass confirmed clean one-column mode cards, a wrapping weekday grid, sticky actions, and no horizontal overflow.

final result: passed

---

# Regeneration feedback design QA

## Evidence

- Browser viewport: 1280 x 720 CSS pixels at the in-app browser's default density
- Source pixels: 470 x 182; the Retina-style source was judged at its apparent 2x density
- Implementation pixels: 1280 x 720 full view, 138 x 44 idle control, and 158 x 44 completed control
- State: authenticated Week view with an existing schedule proposal

## Comparison

The full view keeps the regeneration control in the source position at the top-right of the
draft card. The focused comparison confirms that the idle control preserves the existing white
surface, border, radius, icon, typography, and spacing. The completed state uses the same control
shape and hierarchy, then adds a restrained mint success treatment, check icon, and short pulse.
No image assets are present or required for this control.

Important details were readable in the focused captures, so no additional crop was needed.

## Required fidelity surfaces

- Fonts and typography: existing application font, weight, size, and one-line label are preserved.
- Spacing and layout rhythm: 44px control height and top-right alignment remain stable; the success
  label grows leftward without moving surrounding content.
- Colors and visual tokens: the idle state retains the source tokens; progress and completion use
  existing mint semantic colors with sufficient contrast.
- Image quality and assets: not applicable; the interface uses the existing Lucide icon set.
- Copy and content: `Regenerate`, `Regenerating…`, and `Draft updated` clearly describe each state.

## Interaction and accessibility checks

- Clicking Regenerate showed the disabled `Regenerating…` state with a spinning progress icon.
- Completion showed `Draft updated` with a check and success pulse before returning to idle.
- The changing label is exposed through `aria-live="polite"`; progress exposes `aria-busy`.
- The global reduced-motion preference collapses the new animations.
- The browser console showed no application errors during repeated regeneration.

## Findings

No actionable P0, P1, or P2 differences remain. The completion treatment is intentionally distinct
from the source idle state while preserving its component design language.

## Comparison history

- Initial implementation: no P0/P1/P2 findings.
- Post-interaction evidence: confirmed running and completed states, stable layout, accessible copy,
  and no browser errors; no corrective visual iteration was required.

## Implementation checklist

- [x] Visible progress state
- [x] Animated completion confirmation
- [x] Automatic return to the idle label
- [x] Reduced-motion and accessible status support
- [x] Desktop browser interaction and console verification

final result: passed

---

# Design QA: draft calendar console

## Evidence

- Source: an approved multi-artboard design canvas — a dark, dense week grid with a
  category rail per event, a left-hand unplaced-work rail, a docked block inspector, a
  command palette, and a day timeline for narrow screens.
- Desktop implementation: 1280 x 720 CSS viewport at device pixel ratio 1, checked in the
  Week, 3 days and Day spans.
- Mobile implementation: 375 x 812 CSS viewport at device pixel ratio 1.
- State: a 14-day draft with seven generated blocks, three unplaced items, recurring
  classes, a work shift, a gym commitment, and a dentist appointment overlapping a lab.

## Findings

- P0: none.
- P1: none remaining. Two were found and fixed during the pass: the inspector anchored to
  the console rather than the calendar body and covered the toolbar, and the mobile agenda
  opened on the first day of the span instead of today.
- P2: none remaining. Course codes were clipped by the time range in week columns, cards
  split by an overlap truncated every line, the first hour label was clipped by the scroll
  box, the current-time marker collided with the hour label, and open-time targets were
  nearly invisible against the dark grid.
- P3: the calendar is a dark surface inside the otherwise light application. This is
  intentional and scoped to the draft review; the surrounding page is unchanged.

## Required fidelity surfaces

- Fonts and typography: the existing DoNext font stack is kept. The 8-11px mix is replaced
  by a 10.5/11.5/12.5/16.5px ramp with tabular figures for every time.
- Spacing and layout rhythm: one solid rule per hour at a 62px default, no half-hour
  hatching, and no per-column background pattern. Blocks are positioned by minute rather
  than snapped to 30-minute rows.
- Colours and visual tokens: category meaning is preserved — violet for classes, green for
  editable drafts, slate for work and fixed commitments — retuned for a dark surface and
  scoped to `.draft-console` so no other page is affected.
- Image and icon quality: no raster assets; the existing Lucide set is reused throughout.
- Copy and content: nothing is removed. The "Still unresolved" list moved from the review
  body into the calendar rail with the same name, remaining minutes, and reason.

## Interaction and accessibility checks

- Dragging a block by its handle moves it, snapped to 15 minutes and whole day columns.
- Clicking open time opens the block editor for that day, as before.
- Selecting a block opens the inspector; Edit, Duplicate and Delete are reachable at every
  width, which was not true of the previous implementation at desktop sizes.
- Start and length steppers, and the arrow-key nudges, all issue the same PATCH the drag
  does, so the API remains the single validator for focus hours and overlaps.
- Delete is a two-step confirmation and stays undoable through the status line.
- Unplaced items drag onto the grid; the placed length is trimmed to the free run inside
  the focus window and the status line reports what remains unplaced.
- Cmd/Ctrl+K opens the command palette; only that chord is intercepted globally.
- Event type is never carried by colour alone: a dashed outline plus a drag handle marks
  an editable draft, and every card names its category or course code.
- Day chips, the New block button and every agenda row clear 44px on touch.
- `prefers-reduced-motion` disables every transition and animation on the surface.
- Browser console warnings and errors: none.

## Comparison history

1. The first desktop pass showed clipped course codes, a clipped 8 AM label, and a
   current-time marker colliding with the hour beneath it.
2. Cards were given a compact time in narrow columns and hour labels were moved under
   their rule; the marker was given its own background.
3. The second pass exposed the inspector covering the toolbar and a wrapped start stepper.
4. The mobile pass exposed the agenda defaulting to the wrong day and overflowing
   open-time labels.
5. The final desktop, 3-day, Day and 390px passes showed no remaining P0, P1 or P2 issues.

final result: passed
