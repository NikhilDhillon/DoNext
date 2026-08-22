# Design QA: per-day commitment times

## Evidence

- Source visual truth: `artifacts/commitment-shared-time-source.png`
- Browser-rendered desktop implementation: `artifacts/commitment-per-day-times.jpg`
- Browser-rendered mobile implementation: `artifacts/commitment-per-day-times-mobile-top.jpg` and `artifacts/commitment-per-day-times-mobile-viewport.jpg`
- Full comparison: `artifacts/commitment-per-day-times-comparison.png`
- Focused schedule comparison: `artifacts/commitment-per-day-times-focused-comparison.png`
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

- Source visual truth: `/var/folders/wf/j9x8hm7j7r7g6tffvr85bbbc0000gn/T/TemporaryItems/NSIRD_screencaptureui_XWzCcN/Screenshot 2026-08-21 at 10.40.22 AM.png`
- Browser-rendered desktop implementation: `artifacts/flexible-commitment-desktop-fixed.png`
- Browser-rendered mobile implementation: `artifacts/flexible-commitment-mobile-viewport.png`
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
