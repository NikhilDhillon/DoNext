# Design QA: Academic onboarding

## Visual sources

- Reference: `/var/folders/wf/j9x8hm7j7r7g6tffvr85bbbc0000gn/T/TemporaryItems/NSIRD_screencaptureui_YRIOqr/Screenshot 2026-08-04 at 10.03.34 PM.png`
- Desktop implementation: `artifacts/onboarding-outline-desktop.png`
- Mobile implementation: `artifacts/onboarding-class-schedule-mobile.png`

## Capture conditions

| Surface | Size | State |
| --- | ---: | --- |
| Reference | 2798 x 1618 | Original course-entry step |
| Desktop implementation | 1265 x 712 | Parsed TXT outline ready for review |
| Mobile implementation | 375 x 812 | Class schedule form at step 3 |

The desktop implementation was compared with the reference at their native captures. The smaller implementation viewport naturally places the lower assignment rows below the fold; the page remains vertically scrollable and the persistent navigation stays reachable.

## Comparison

### Full view

- Preserved the split onboarding shell, dark progress rail, warm canvas, rounded white cards, green accents, typography hierarchy, and bottom navigation treatment from the reference.
- Replaced the original blank course form with an upload-first action and a review card while keeping form controls aligned to the established grid and spacing system.
- Added a compact mobile header and fixed action bar at the existing responsive breakpoint. No horizontal overflow or clipped controls were observed at 375 x 812.

### Focused regions

- Upload area: clear primary action, supported formats, size limit, and drag-and-drop affordance are visible before any manual fields.
- Extraction review: file name, number of academic items and class meetings, editable course details, editable deadlines, confidence labels, remove actions, and an explicit confirmation action are present.
- Manual fallback: expandable manual course and academic-item forms remain available after upload.
- Class schedule: imported meetings are visible; a single course/time form supports multiple selected weekdays, location, and travel buffers.
- Navigation: the seven-step order is Semester, Course outlines, Class schedule, Commitments, Goals, Boundaries, Review.

## Functional evidence

- Parsed `CSC 320 Algorithms`, instructor `Dr. Chen`, two dated academic items, and three Monday/Wednesday/Friday meetings from one local outline.
- Confirming the proposal persisted the course, assignments, exams, and recurring class events.
- One Tuesday/Thursday submission created two recurring classes.
- Weekly meetings render in Monday-to-Sunday order, then by start time.
- Manual entry expanded and exposed both course and academic-item forms.
- Browser console errors: none.

## Findings

- P0: none.
- P1: none.
- P2: none.
- P3: scanned PDFs without embedded text require manual entry; OCR and model-assisted interpretation are outside this local-parser milestone.

## Comparison history

1. Initial implementation passed the upload, extraction review, manual fallback, and responsive layout checks.
2. Weekly meetings initially followed creation-date order; the list was changed to weekday and start-time order and rechecked.

## Final result

Passed. The implementation is visually consistent with the supplied onboarding reference and the requested academic setup flow is usable at desktop and mobile sizes.
