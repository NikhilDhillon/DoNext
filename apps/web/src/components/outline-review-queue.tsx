"use client";

import {
  AlertTriangle,
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  GraduationCap,
  Info,
  Pencil,
  Scale,
  Settings2,
  ShieldCheck,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";

import type {
  AssessmentGroupProposal,
  Course,
  GradingSchemeComponentProposal,
  OutlineExtraction,
  OutlineItemProposal,
} from "@/lib/types";

type ReviewTab = "issues" | "items" | "schemes";

type OutlineReviewQueueProps = {
  proposal: OutlineExtraction;
  busy: boolean;
  existingCourse: Course | null;
  semesterEndDate: string;
  onChange: (proposal: OutlineExtraction) => void;
  onDismiss: () => void;
  onImport: () => void;
  onRemoveItem: (itemIndex: number) => void;
  onUpdateSchemeComponent: (
    schemeIndex: number,
    componentIndex: number,
    updates: Partial<GradingSchemeComponentProposal>,
  ) => void;
};

export function OutlineReviewQueue({
  proposal,
  busy,
  existingCourse,
  semesterEndDate,
  onChange,
  onDismiss,
  onImport,
  onRemoveItem,
  onUpdateSchemeComponent,
}: OutlineReviewQueueProps) {
  const [tab, setTab] = useState<ReviewTab>("issues");
  const [acknowledgedMissingDates, setAcknowledgedMissingDates] = useState<Set<number>>(() => new Set());
  const [acceptedUnknownWeights, setAcceptedUnknownWeights] = useState<Set<number>>(() => new Set());
  const [confirmedEqualGroups, setConfirmedEqualGroups] = useState<Set<string>>(() => new Set());
  const [editingEqualGroup, setEditingEqualGroup] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<number | null>(null);

  const primarySchemeIndex = Math.max(0, proposal.schemes.findIndex((scheme) => scheme.is_primary));
  const primaryScheme = proposal.schemes[primarySchemeIndex];
  const missingCourseDetails = !proposal.course.code?.trim() || !proposal.course.name?.trim();
  const missingDateItems = proposal.items
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => !item.deadline_at && !acknowledgedMissingDates.has(index));
  const unknownWeightItems = proposal.items
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) =>
      !item.group_key
      && item.weight_percent === null
      && !acceptedUnknownWeights.has(index),
    );
  const inferredGroups = proposal.groups.filter((group) =>
    proposal.items.some((item) => item.group_key === group.key && item.weight_origin === "inferred_equal")
    && proposal.schemes
      .find((scheme) => scheme.is_primary)?.components
      .some((component) => component.target_group_key === group.key && isAllocationDecisionRule(component.selection_rule))
    && !confirmedEqualGroups.has(group.key),
  );
  const incompleteSchemes = proposal.schemes
    .map((scheme, index) => ({ scheme, index }))
    .filter(({ scheme }) => !scheme.is_complete);
  const reviewedDateItems = proposal.items
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) => !item.deadline_at && acknowledgedMissingDates.has(index));
  const reviewedUnknownWeightItems = proposal.items
    .map((item, index) => ({ item, index }))
    .filter(({ item, index }) =>
      !item.group_key
      && item.weight_percent === null
      && acceptedUnknownWeights.has(index),
    );
  const reviewedGroups = proposal.groups.filter((group) => confirmedEqualGroups.has(group.key));
  const issueCount = (missingCourseDetails ? 1 : 0)
    + missingDateItems.length
    + unknownWeightItems.length
    + inferredGroups.length
    + incompleteSchemes.length;
  const unresolvedItemIndexes = new Set([
    ...missingDateItems.map(({ index }) => index),
    ...unknownWeightItems.map(({ index }) => index),
    ...proposal.items
      .map((item, index) => inferredGroups.some((group) => group.key === item.group_key) ? index : -1)
      .filter((index) => index >= 0),
  ]);
  const reviewedItemIndexes = new Set([
    ...reviewedDateItems.map(({ index }) => index),
    ...reviewedUnknownWeightItems.map(({ index }) => index),
    ...proposal.items
      .map((item, index) => reviewedGroups.some((group) => group.key === item.group_key) ? index : -1)
      .filter((index) => index >= 0),
  ]);
  const reviewedDecisionCount = reviewedDateItems.length
    + reviewedUnknownWeightItems.length
    + reviewedGroups.length;
  const readyCount = proposal.items.filter(
    (_, index) => !unresolvedItemIndexes.has(index) && !reviewedItemIndexes.has(index),
  ).length;
  const filteredWarnings = reviewWarnings(proposal);
  const courseTitle = [proposal.course.code, proposal.course.name].filter(Boolean).join(" · ") || "Untitled course";

  function updateItem(itemIndex: number, updates: Partial<OutlineItemProposal>) {
    onChange({
      ...proposal,
      items: proposal.items.map((item, index) => index === itemIndex ? { ...item, ...updates } : item),
    });
  }

  function updateGroup(groupKey: string, updates: Partial<AssessmentGroupProposal>) {
    onChange({
      ...proposal,
      groups: proposal.groups.map((group) => group.key === groupKey ? { ...group, ...updates } : group),
    });
  }

  function acknowledgeMissingDate(itemIndex: number) {
    setAcknowledgedMissingDates((current) => new Set(current).add(itemIndex));
  }

  function acceptUnknownWeight(itemIndex: number) {
    setAcceptedUnknownWeights((current) => new Set(current).add(itemIndex));
  }

  function confirmEqualGroup(groupKey: string) {
    setConfirmedEqualGroups((current) => new Set(current).add(groupKey));
    setEditingEqualGroup(null);
  }

  function reopenDateDecision(itemIndex: number) {
    setAcknowledgedMissingDates((current) => {
      const next = new Set(current);
      next.delete(itemIndex);
      return next;
    });
  }

  function reopenUnknownWeightDecision(itemIndex: number) {
    setAcceptedUnknownWeights((current) => {
      const next = new Set(current);
      next.delete(itemIndex);
      return next;
    });
  }

  function reopenGroupDecision(groupKey: string) {
    setConfirmedEqualGroups((current) => {
      const next = new Set(current);
      next.delete(groupKey);
      return next;
    });
  }

  function switchTab(nextTab: ReviewTab) {
    setTab(nextTab);
    setEditingItem(null);
  }

  return (
    <article className="review-queue" aria-label={`Review ${courseTitle}`}>
      <header className="review-queue-heading">
        <div>
          <p className="eyebrow">Course outline review</p>
          <h2>Review {proposal.course.code?.trim() || "this course"}</h2>
          <p>
            {proposal.items.length} {proposal.items.length === 1 ? "assessment" : "assessments"} found
            <span aria-hidden="true">·</span>
            {proposal.schemes.length} grading {proposal.schemes.length === 1 ? "scheme" : "schemes"}
            <span aria-hidden="true">·</span>
            <strong>{issueCount ? `${issueCount} ${issueCount === 1 ? "item needs" : "items need"} you` : "ready to confirm"}</strong>
          </p>
        </div>
        <button className="review-dismiss" type="button" onClick={onDismiss} aria-label={`Dismiss ${courseTitle} review`}>
          <X size={18} />
        </button>
      </header>

      <div className="review-tabs" aria-label="Outline review views">
        <button
          aria-pressed={tab === "issues"}
          className={tab === "issues" ? "active" : ""}
          type="button"
          onClick={() => switchTab("issues")}
        >
          Needs review ({issueCount})
        </button>
        <button
          aria-pressed={tab === "items"}
          className={tab === "items" ? "active" : ""}
          type="button"
          onClick={() => switchTab("items")}
        >
          All extracted ({proposal.items.length})
        </button>
        <button
          aria-pressed={tab === "schemes"}
          className={tab === "schemes" ? "active" : ""}
          type="button"
          onClick={() => switchTab("schemes")}
        >
          Grading schemes ({proposal.schemes.length})
        </button>
      </div>

      <div className="review-queue-layout">
        <div className="review-queue-main">
          {tab === "issues" ? (
            <NeedsReview
              editingEqualGroup={editingEqualGroup}
              incompleteSchemes={incompleteSchemes}
              inferredGroups={inferredGroups}
              missingCourseDetails={missingCourseDetails}
              missingDateItems={missingDateItems}
              proposal={proposal}
              semesterEndDate={semesterEndDate}
              unknownWeightItems={unknownWeightItems}
              onAcknowledgeMissingDate={acknowledgeMissingDate}
              onAcceptUnknownWeight={acceptUnknownWeight}
              onConfirmEqualGroup={confirmEqualGroup}
              onEditEqualGroup={setEditingEqualGroup}
              onProposalChange={onChange}
              onUpdateGroup={updateGroup}
              onUpdateItem={updateItem}
              onUpdateSchemeComponent={onUpdateSchemeComponent}
            />
          ) : null}

          {tab === "items" ? (
            <AllExtracted
              acknowledgedMissingDates={acknowledgedMissingDates}
              editingItem={editingItem}
              proposal={proposal}
              semesterEndDate={semesterEndDate}
              onEditItem={setEditingItem}
              onProposalChange={onChange}
              onRemoveItem={onRemoveItem}
              onUpdateItem={updateItem}
            />
          ) : null}

          {tab === "schemes" ? (
            <GradingSchemes
              proposal={proposal}
              onUpdateSchemeComponent={onUpdateSchemeComponent}
            />
          ) : null}

          {tab === "issues" && issueCount === 0 ? (
            <section className="review-ready-state" aria-live="polite">
              <span><Check size={21} /></span>
              <div>
                <strong>Everything that needs a decision is resolved.</strong>
                <p>You can still inspect every extracted item or grading scheme before confirming.</p>
              </div>
            </section>
          ) : null}

          {tab === "issues" && reviewedDecisionCount > 0 ? (
            <ReviewedDecisions
              dateItems={reviewedDateItems}
              groups={reviewedGroups}
              proposal={proposal}
              semesterEndDate={semesterEndDate}
              unknownWeightItems={reviewedUnknownWeightItems}
              onChangeDate={reopenDateDecision}
              onChangeGroup={reopenGroupDecision}
              onChangeUnknownWeight={reopenUnknownWeightDecision}
            />
          ) : null}

          {tab === "issues" && readyCount > 0 ? (
            <button className="review-ready-row" type="button" onClick={() => switchTab("items")}>
              <span><Check size={18} /></span>
              <span><strong>{readyCount} other {readyCount === 1 ? "assessment looks" : "assessments look"} ready.</strong><small>You can review them before confirming.</small></span>
              <span>Review all extracted <ChevronDown size={16} /></span>
            </button>
          ) : null}

          {filteredWarnings.length ? (
            <details className="review-notes">
              <summary><Info size={16} /> {filteredWarnings.length} other extraction {filteredWarnings.length === 1 ? "note" : "notes"}</summary>
              <ul>{filteredWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </details>
          ) : null}
        </div>

        <CourseSummary
          primaryScheme={primaryScheme}
          proposal={proposal}
          onShowSchemes={() => switchTab("schemes")}
        />
      </div>

      {existingCourse ? (
        <p className="review-update-notice">
          <AlertTriangle size={16} />
          <span><strong>{proposal.course.code} is already added.</strong> Confirming replaces its saved assessments and grading schemes with this reviewed version.</span>
        </p>
      ) : null}

      <footer className="review-queue-footer">
        <span><ShieldCheck size={16} /> Nothing is imported until you confirm.</span>
        <button
          className="primary-button"
          disabled={busy || issueCount > 0}
          type="button"
          onClick={onImport}
        >
          {issueCount > 0
            ? `Resolve ${issueCount} ${issueCount === 1 ? "item" : "items"} to continue`
            : existingCourse ? "Confirm course updates" : "Confirm and add course"}
        </button>
      </footer>
    </article>
  );
}

function ReviewedDecisions({
  dateItems,
  groups,
  proposal,
  semesterEndDate,
  unknownWeightItems,
  onChangeDate,
  onChangeGroup,
  onChangeUnknownWeight,
}: {
  dateItems: { item: OutlineItemProposal; index: number }[];
  groups: AssessmentGroupProposal[];
  proposal: OutlineExtraction;
  semesterEndDate: string;
  unknownWeightItems: { item: OutlineItemProposal; index: number }[];
  onChangeDate: (itemIndex: number) => void;
  onChangeGroup: (groupKey: string) => void;
  onChangeUnknownWeight: (itemIndex: number) => void;
}) {
  const decisionCount = dateItems.length + groups.length + unknownWeightItems.length;

  return (
    <section className="reviewed-decisions" aria-labelledby="reviewed-decisions-title">
      <header>
        <div>
          <strong id="reviewed-decisions-title">Reviewed decisions</strong>
          <small>Your confirmed choices stay visible until you import.</small>
        </div>
        <span>{decisionCount} reviewed</span>
      </header>
      <div>
        {dateItems.map(({ item, index }) => (
          <ReviewedDecisionRow
            key={`reviewed-date-${item.key ?? index}`}
            summary={isFinalExam(item) ? `Expected ${formatMonthYear(semesterEndDate)}` : "Date remains unknown"}
            title={`${item.name} date`}
            onChange={() => onChangeDate(index)}
          />
        ))}
        {groups.map((group) => {
          const groupItems = proposal.items.filter((item) => item.group_key === group.key);
          const groupWeight = proposal.schemes
            .find((scheme) => scheme.is_primary)?.components
            .find((component) => component.target_group_key === group.key)?.weight_percent;
          const equalShare = groupItems.length && groupWeight !== undefined
            ? groupWeight / groupItems.length
            : null;
          const summary = group.allocation_method === "explicit_percent"
            ? "Individual weights confirmed"
            : equalShare === null ? "Equal shares confirmed" : `Equal shares · ${formatPercent(equalShare)} each`;

          return (
            <ReviewedDecisionRow
              key={`reviewed-group-${group.key}`}
              summary={summary}
              title={`${group.name} weights`}
              onChange={() => onChangeGroup(group.key)}
            />
          );
        })}
        {unknownWeightItems.map(({ item, index }) => (
          <ReviewedDecisionRow
            key={`reviewed-weight-${item.key ?? index}`}
            summary="Weight remains unknown"
            title={`${item.name} weight`}
            onChange={() => onChangeUnknownWeight(index)}
          />
        ))}
      </div>
    </section>
  );
}

function ReviewedDecisionRow({
  summary,
  title,
  onChange,
}: {
  summary: string;
  title: string;
  onChange: () => void;
}) {
  return (
    <article className="reviewed-decision-row">
      <span><Check size={15} /></span>
      <div><strong>{title}</strong><small>{summary}</small></div>
      <button type="button" onClick={onChange} aria-label={`Change ${title}`}>Change</button>
    </article>
  );
}

type NeedsReviewProps = {
  editingEqualGroup: string | null;
  incompleteSchemes: { scheme: OutlineExtraction["schemes"][number]; index: number }[];
  inferredGroups: AssessmentGroupProposal[];
  missingCourseDetails: boolean;
  missingDateItems: { item: OutlineItemProposal; index: number }[];
  proposal: OutlineExtraction;
  semesterEndDate: string;
  unknownWeightItems: { item: OutlineItemProposal; index: number }[];
  onAcknowledgeMissingDate: (itemIndex: number) => void;
  onAcceptUnknownWeight: (itemIndex: number) => void;
  onConfirmEqualGroup: (groupKey: string) => void;
  onEditEqualGroup: (groupKey: string | null) => void;
  onProposalChange: (proposal: OutlineExtraction) => void;
  onUpdateGroup: (groupKey: string, updates: Partial<AssessmentGroupProposal>) => void;
  onUpdateItem: (itemIndex: number, updates: Partial<OutlineItemProposal>) => void;
  onUpdateSchemeComponent: (
    schemeIndex: number,
    componentIndex: number,
    updates: Partial<GradingSchemeComponentProposal>,
  ) => void;
};

function NeedsReview({
  editingEqualGroup,
  incompleteSchemes,
  inferredGroups,
  missingCourseDetails,
  missingDateItems,
  proposal,
  semesterEndDate,
  unknownWeightItems,
  onAcknowledgeMissingDate,
  onAcceptUnknownWeight,
  onConfirmEqualGroup,
  onEditEqualGroup,
  onProposalChange,
  onUpdateGroup,
  onUpdateItem,
  onUpdateSchemeComponent,
}: NeedsReviewProps) {
  const count = (missingCourseDetails ? 1 : 0)
    + missingDateItems.length
    + unknownWeightItems.length
    + inferredGroups.length
    + incompleteSchemes.length;

  return (
    <section className="needs-review-panel">
      {count ? <p className="review-tab-intro">These items need your attention before DoNext can import the course.</p> : null}

      {missingCourseDetails ? (
        <ReviewIssueCard
          confidence={proposal.course.confidence}
          icon={<AlertTriangle size={18} />}
          title="Course details need confirmation"
          copy="Add the course code and name so this outline is saved to the right course."
        >
          <div className="review-course-fields">
            <label><span>Course code</span><input value={proposal.course.code ?? ""} onChange={(event) => onProposalChange({ ...proposal, course: { ...proposal.course, code: event.target.value } })} placeholder="CSC 349A" /></label>
            <label><span>Course name</span><input value={proposal.course.name ?? ""} onChange={(event) => onProposalChange({ ...proposal, course: { ...proposal.course, name: event.target.value } })} placeholder="Numerical Analysis" /></label>
          </div>
        </ReviewIssueCard>
      ) : null}

      {missingDateItems.map(({ item, index }) => {
        const finalExam = isFinalExam(item);
        const semesterEndMonth = formatMonth(semesterEndDate);

        return (
          <ReviewIssueCard
            confidence={item.confidence}
            icon={<AlertTriangle size={18} />}
            key={`date-${item.key ?? index}`}
            title={`${item.name} — missing date`}
            copy="We couldn’t find a clear due date in the uploaded documents."
            source={item.source_text}
            sourceFiles={proposal.source_files}
          >
            <div className="review-date-choice">
              <label>
                <span>Official date</span>
                <input
                  aria-label={`${item.name} date`}
                  type="date"
                  value={item.deadline_at?.slice(0, 10) ?? ""}
                  onChange={(event) => onUpdateItem(index, { deadline_at: event.target.value ? `${event.target.value}T23:59:00` : null })}
                />
              </label>
              <span>or</span>
              <button className="secondary-button" type="button" onClick={() => onAcknowledgeMissingDate(index)}>
                {finalExam ? `Expected in ${semesterEndMonth}` : "I don’t know the date yet"}
              </button>
            </div>
            <p className="review-choice-help">
              {finalExam
                ? `This ${semesterEndMonth} estimate comes from the semester end, not the course outline. DoNext will keep the official date unresolved and won’t schedule the exam until you add it.`
                : "The item stays visible, but DoNext will not place it on a generated schedule until you add a date."}
            </p>
          </ReviewIssueCard>
        );
      })}

      {inferredGroups.map((group) => {
        const groupItems = proposal.items
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.group_key === group.key);
        const courseComponent = proposal.schemes
          .find((scheme) => scheme.is_primary)?.components
          .find((component) => component.target_group_key === group.key);
        const groupWeight = courseComponent?.weight_percent ?? null;
        const equalShare = groupItems.length && groupWeight !== null
          ? groupWeight / groupItems.length
          : null;
        const editing = editingEqualGroup === group.key;

        return (
          <ReviewIssueCard
            confidence={group.extraction_confidence}
            icon={<AlertTriangle size={18} />}
            key={`group-${group.key}`}
            title={`${group.name} weights — need confirmation`}
            copy={`The outline gives ${group.name}${groupWeight !== null ? ` ${formatPercent(groupWeight)}` : " a group weight"}, but not every individual weight. DoNext can use equal shares or you can enter them.`}
            source={group.source_text}
            sourceFiles={proposal.source_files}
          >
            <fieldset className="review-choice-grid">
              <legend>How should DoNext calculate these weights?</legend>
              <button className="review-choice" type="button" onClick={() => onConfirmEqualGroup(group.key)}>
                <span className="review-radio" aria-hidden="true" />
                <span><strong>Use equal shares <small>Recommended</small></strong><em>{equalShare !== null ? `Each item = ${formatPercent(equalShare)}` : "Split the group evenly"}</em></span>
              </button>
              <button className={`review-choice${editing ? " selected" : ""}`} type="button" onClick={() => onEditEqualGroup(editing ? null : group.key)}>
                <span className="review-radio" aria-hidden="true" />
                <span><strong>Enter individual weights</strong><em>I’ll provide specific percentages</em></span>
              </button>
            </fieldset>
            {editing ? (
              <div className="individual-weight-editor">
                {groupItems.map(({ item, index }) => (
                  <label key={item.key ?? index}>
                    <span>{item.name}</span>
                    <span><input aria-label={`${item.name} within-group weight`} min="0" max="100" step="0.5" type="number" value={item.relative_weight_percent ?? ""} onChange={(event) => onUpdateItem(index, { relative_weight_percent: event.target.value === "" ? null : Number(event.target.value), weight_origin: event.target.value === "" ? "unknown" : "manual" })} />%</span>
                  </label>
                ))}
                <button
                  className="secondary-button"
                  disabled={!weightsTotalOneHundred(groupItems.map(({ item }) => item.relative_weight_percent))}
                  type="button"
                  onClick={() => {
                    onUpdateGroup(group.key, { allocation_method: "explicit_percent", weight_origin: "manual" });
                    onConfirmEqualGroup(group.key);
                  }}
                >
                  Confirm individual weights
                </button>
                <small>Individual weights must total 100% within this group.</small>
              </div>
            ) : null}
          </ReviewIssueCard>
        );
      })}

      {unknownWeightItems.map(({ item, index }) => (
        <ReviewIssueCard
          confidence={item.confidence}
          icon={<AlertTriangle size={18} />}
          key={`weight-${item.key ?? index}`}
          title={`${item.name} — weight unknown`}
          copy="No reliable course weight was found for this assessment. You can add it now or keep it unknown."
          source={item.source_text}
          sourceFiles={proposal.source_files}
        >
          <div className="review-date-choice">
            <label>
              <span>Course weight</span>
              <span className="inline-percent-input"><input aria-label={`${item.name} course weight`} min="0" max="100" step="0.5" type="number" value={item.weight_percent ?? ""} onChange={(event) => onUpdateItem(index, { weight_percent: event.target.value === "" ? null : Number(event.target.value), weight_origin: event.target.value === "" ? "unknown" : "manual" })} />%</span>
            </label>
            <span>or</span>
            <button className="secondary-button" type="button" onClick={() => onAcceptUnknownWeight(index)}>Keep weight unknown</button>
          </div>
        </ReviewIssueCard>
      ))}

      {incompleteSchemes.map(({ scheme, index }) => (
        <ReviewIssueCard
          icon={<AlertTriangle size={18} />}
          key={`scheme-${scheme.key}`}
          title={`${scheme.name} — incomplete grading scheme`}
          copy="The known components do not add up to 100%. Review the weights before importing."
        >
          <SchemeComponents proposal={proposal} schemeIndex={index} onUpdate={onUpdateSchemeComponent} />
        </ReviewIssueCard>
      ))}
    </section>
  );
}

function ReviewIssueCard({
  children,
  confidence,
  copy,
  icon,
  source,
  sourceFiles,
  title,
}: {
  children: React.ReactNode;
  confidence?: number;
  copy: string;
  icon: React.ReactNode;
  source?: string | null;
  sourceFiles?: string[];
  title: string;
}) {
  return (
    <article className="review-issue-card">
      <header>
        <span>{icon}</span>
        <div><strong>{title}</strong><p>{copy}</p></div>
        {confidence !== undefined ? <small>Source confidence: {Math.round(confidence * 100)}% <Info size={13} /></small> : null}
      </header>
      <div className="review-issue-body">{children}</div>
      {source ? (
        <details className="review-source">
          <summary><ChevronDown size={15} /> Source</summary>
          <blockquote>{source}</blockquote>
          {sourceFiles?.length ? <small>{sourceFiles.join(" · ")}</small> : null}
        </details>
      ) : null}
    </article>
  );
}

function AllExtracted({
  acknowledgedMissingDates,
  editingItem,
  proposal,
  semesterEndDate,
  onEditItem,
  onProposalChange,
  onRemoveItem,
  onUpdateItem,
}: {
  acknowledgedMissingDates: Set<number>;
  editingItem: number | null;
  proposal: OutlineExtraction;
  semesterEndDate: string;
  onEditItem: (itemIndex: number | null) => void;
  onProposalChange: (proposal: OutlineExtraction) => void;
  onRemoveItem: (itemIndex: number) => void;
  onUpdateItem: (itemIndex: number, updates: Partial<OutlineItemProposal>) => void;
}) {
  const groupedItemIndexes = new Set<number>();
  return (
    <section className="all-extracted-panel">
      <p className="review-tab-intro">Scan everything DoNext found. Open a row only when you want to change it.</p>
      <section className="review-course-details">
        <header><span><BookOpenCheck size={18} /></span><div><strong>Course details</strong><small>Used to identify this course throughout DoNext.</small></div></header>
        <div className="review-course-fields three">
          <label><span>Course code</span><input value={proposal.course.code ?? ""} onChange={(event) => onProposalChange({ ...proposal, course: { ...proposal.course, code: event.target.value } })} /></label>
          <label><span>Course name</span><input value={proposal.course.name ?? ""} onChange={(event) => onProposalChange({ ...proposal, course: { ...proposal.course, name: event.target.value } })} /></label>
          <label><span>Instructor <small>Optional</small></span><input value={proposal.course.instructor ?? ""} onChange={(event) => onProposalChange({ ...proposal, course: { ...proposal.course, instructor: event.target.value || null } })} /></label>
        </div>
      </section>

      <div className="extracted-groups">
        {proposal.groups.map((group) => {
          const groupItems = proposal.items
            .map((item, index) => ({ item, index }))
            .filter(({ item, index }) => {
              if (item.group_key !== group.key) return false;
              groupedItemIndexes.add(index);
              return true;
            });
          if (!groupItems.length) return null;
          const component = proposal.schemes.find((scheme) => scheme.is_primary)?.components.find((value) => value.target_group_key === group.key);
          return (
            <section className="extracted-group" key={group.key}>
              <header>
                <div><strong>{group.name}</strong><small>{groupItems.length} {groupItems.length === 1 ? "item" : "items"}{component ? ` · ${formatPercent(component.weight_percent)} · ${formatRule(component)}` : ""}</small></div>
                <span>{formatOrigin(group.weight_origin)} · {Math.round(group.extraction_confidence * 100)}%</span>
              </header>
              {groupItems.map(({ item, index }) => (
                <ExtractedItemRow
                  editing={editingItem === index}
                  estimatedDeadlineDate={acknowledgedMissingDates.has(index) && isFinalExam(item) ? semesterEndDate : null}
                  groupCourseWeight={component?.weight_percent ?? null}
                  item={item}
                  itemIndex={index}
                  key={item.key ?? index}
                  selectionRule={component?.selection_rule ?? null}
                  onEdit={onEditItem}
                  onRemove={onRemoveItem}
                  onUpdate={onUpdateItem}
                />
              ))}
              {component && isReplacementAttemptRule(component.selection_rule) ? (
                <p className="replacement-attempt-note">
                  <Info size={14} />
                  <span>
                    <strong>One shared {formatPercent(component.weight_percent)} course weight.</strong>
                    {component.selection_rule === "highest_attempt"
                      ? " The highest-scoring attempt supplies that grade; the weight is not split between attempts."
                      : " The latest attempt supplies that grade; the weight is not split between attempts."}
                  </span>
                </p>
              ) : null}
              {group.source_text ? <details className="group-source"><summary>View source</summary><p>{group.source_text}</p></details> : null}
            </section>
          );
        })}

        {proposal.items.map((item, index) => groupedItemIndexes.has(index) ? null : (
          <ExtractedItemRow
            editing={editingItem === index}
            estimatedDeadlineDate={acknowledgedMissingDates.has(index) && isFinalExam(item) ? semesterEndDate : null}
            groupCourseWeight={null}
            item={item}
            itemIndex={index}
            key={item.key ?? index}
            selectionRule={null}
            onEdit={onEditItem}
            onRemove={onRemoveItem}
            onUpdate={onUpdateItem}
          />
        ))}
      </div>
    </section>
  );
}

function ExtractedItemRow({
  editing,
  estimatedDeadlineDate,
  groupCourseWeight,
  item,
  itemIndex,
  selectionRule,
  onEdit,
  onRemove,
  onUpdate,
}: {
  editing: boolean;
  estimatedDeadlineDate: string | null;
  groupCourseWeight: number | null;
  item: OutlineItemProposal;
  itemIndex: number;
  selectionRule: GradingSchemeComponentProposal["selection_rule"] | null;
  onEdit: (itemIndex: number | null) => void;
  onRemove: (itemIndex: number) => void;
  onUpdate: (itemIndex: number, updates: Partial<OutlineItemProposal>) => void;
}) {
  const weight = item.group_key ? item.relative_weight_percent : item.weight_percent;
  const replacementAttempt = selectionRule !== null && isReplacementAttemptRule(selectionRule);
  if (editing) {
    return (
      <div className="extracted-item editing">
        <label><span>Name</span><input value={item.name} onChange={(event) => onUpdate(itemIndex, { name: event.target.value })} /></label>
        <label><span>Date</span><input type="date" value={item.deadline_at?.slice(0, 10) ?? ""} onChange={(event) => onUpdate(itemIndex, { deadline_at: event.target.value ? `${event.target.value}T23:59:00` : null })} /></label>
        {replacementAttempt ? (
          <div className="replacement-weight-field">
            <span>Course weight</span>
            <strong>{groupCourseWeight === null ? "Set by the attempt rule" : `${formatPercent(groupCourseWeight)} if this attempt counts`}</strong>
          </div>
        ) : (
          <label><span>{item.group_key ? "Within group" : "Course weight"}</span><span className="inline-percent-input"><input min="0" max="100" step="0.5" type="number" value={weight ?? ""} onChange={(event) => onUpdate(itemIndex, { [item.group_key ? "relative_weight_percent" : "weight_percent"]: event.target.value === "" ? null : Number(event.target.value), weight_origin: event.target.value === "" ? "unknown" : "manual" })} />%</span></label>
        )}
        <div className="extracted-item-actions"><button className="secondary-button" type="button" onClick={() => onEdit(null)}><Check size={15} /> Done</button><button className="icon-button" aria-label={`Remove ${item.name}`} type="button" onClick={() => onRemove(itemIndex)}><Trash2 size={16} /></button></div>
        <details className="review-source"><summary><ChevronDown size={15} /> Source</summary><blockquote>{item.source_text}</blockquote></details>
      </div>
    );
  }
  return (
    <div className="extracted-item">
      <div><strong>{item.name}</strong><small>{item.kind.replaceAll("_", " ")}</small></div>
      <time
        className={!item.deadline_at && estimatedDeadlineDate ? "estimated" : undefined}
        title={!item.deadline_at && estimatedDeadlineDate ? "Estimated from the semester end; the official exam date is still unknown." : undefined}
      >
        {item.deadline_at
          ? formatDate(item.deadline_at)
          : estimatedDeadlineDate ? `Expected ${formatMonthYear(estimatedDeadlineDate)}` : "No date"}
      </time>
      <span>{replacementAttempt
        ? groupCourseWeight === null ? "Shared group weight" : `${formatPercent(groupCourseWeight)} if counted`
        : weight === null ? "Weight unknown" : formatPercent(weight)}</span>
      <span>{replacementAttempt
        ? `${selectionRule === "highest_attempt" ? "Highest-scoring attempt" : "Latest attempt"} · ${Math.round(item.confidence * 100)}%`
        : `${formatOrigin(item.weight_origin)} · ${Math.round(item.confidence * 100)}%`}</span>
      <button className="icon-button" aria-label={`Edit ${item.name}`} type="button" onClick={() => onEdit(itemIndex)}><Pencil size={15} /></button>
    </div>
  );
}

function GradingSchemes({
  proposal,
  onUpdateSchemeComponent,
}: {
  proposal: OutlineExtraction;
  onUpdateSchemeComponent: (
    schemeIndex: number,
    componentIndex: number,
    updates: Partial<GradingSchemeComponentProposal>,
  ) => void;
}) {
  return (
    <section className="review-schemes-panel">
      <p className="review-tab-intro">Alternatives remain separate. DoNext considers each valid scheme when it calculates academic impact.</p>
      {proposal.schemes.map((scheme, schemeIndex) => (
        <article className="review-scheme" key={scheme.key}>
          <header>
            <div><strong>{scheme.name}</strong><small>{scheme.is_complete ? "Complete 100% scheme" : "Incomplete — adjust the weights below"}</small></div>
            <span>{scheme.is_primary ? "Primary" : scheme.selection_mode === "best_outcome" ? "Alternative" : "Optional"}</span>
          </header>
          <SchemeComponents proposal={proposal} schemeIndex={schemeIndex} onUpdate={onUpdateSchemeComponent} />
        </article>
      ))}
    </section>
  );
}

function SchemeComponents({
  proposal,
  schemeIndex,
  onUpdate,
}: {
  proposal: OutlineExtraction;
  schemeIndex: number;
  onUpdate: (
    schemeIndex: number,
    componentIndex: number,
    updates: Partial<GradingSchemeComponentProposal>,
  ) => void;
}) {
  const scheme = proposal.schemes[schemeIndex];
  return (
    <div className="review-scheme-components">
      {scheme.components.map((component, componentIndex) => {
        const target = targetName(proposal, component);
        return (
          <div key={`${component.target_group_key ?? component.target_item_key}-${componentIndex}`}>
            <strong>{target}</strong>
            <label><span>Weight</span><span className="inline-percent-input"><input aria-label={`${target} weight in ${scheme.name}`} min="0" max="100" step="0.5" type="number" value={component.weight_percent} onChange={(event) => onUpdate(schemeIndex, componentIndex, { weight_percent: Number(event.target.value) })} />%</span></label>
            <label><span>Counting rule</span><select value={component.selection_rule} onChange={(event) => onUpdate(schemeIndex, componentIndex, { selection_rule: event.target.value as GradingSchemeComponentProposal["selection_rule"], selection_count: ["best_n", "drop_lowest_n"].includes(event.target.value) ? (component.selection_count ?? 1) : null })}><option value="all">All items count</option><option value="best_n">Best N</option><option value="drop_lowest_n">Drop lowest N</option><option value="highest_attempt">Highest attempt</option><option value="latest_attempt">Latest attempt</option></select></label>
            {["best_n", "drop_lowest_n"].includes(component.selection_rule) ? <label><span>Number</span><input min="1" type="number" value={component.selection_count ?? 1} onChange={(event) => onUpdate(schemeIndex, componentIndex, { selection_count: Number(event.target.value) })} /></label> : null}
          </div>
        );
      })}
    </div>
  );
}

function CourseSummary({
  primaryScheme,
  proposal,
  onShowSchemes,
}: {
  primaryScheme: OutlineExtraction["schemes"][number] | undefined;
  proposal: OutlineExtraction;
  onShowSchemes: () => void;
}) {
  const summary = primaryScheme?.components.map((component) => ({
    component,
    name: targetName(proposal, component),
  })) ?? [];
  return (
    <aside className="course-review-summary">
      <header><strong>Course summary</strong><p>We extracted the following from your documents.</p></header>
      <div className="course-summary-components">
        {summary.map(({ component, name }, index) => {
          const Icon = index === summary.length - 1 ? GraduationCap : index === 1 ? Scale : FileText;
          return (
            <div key={`${component.target_group_key ?? component.target_item_key}-${index}`}>
              <span><Icon size={18} /></span>
              <span><strong>{name}</strong><small>{formatRule(component)}</small></span>
              <b>{formatPercent(component.weight_percent)}</b>
            </div>
          );
        })}
      </div>
      {proposal.schemes.length > 1 ? (
        <div className="course-summary-alternative">
          <Shuffle size={18} />
          <span><strong>Alternative scheme</strong><small>{proposal.schemes.length - 1} additional grading {proposal.schemes.length === 2 ? "scheme is" : "schemes are"} available.</small><button type="button" onClick={onShowSchemes}>View scheme details</button></span>
        </div>
      ) : null}
      <div className="course-summary-trust"><ShieldCheck size={19} /><span><strong>Nothing is imported yet</strong><small>Your review stays a proposal until you confirm.</small></span></div>
      <button className="course-summary-settings" type="button" onClick={onShowSchemes}><Settings2 size={18} /><span><strong>Advanced options</strong><small>Edit grading rules</small></span><ChevronUp size={16} /></button>
    </aside>
  );
}

function targetName(proposal: OutlineExtraction, component: GradingSchemeComponentProposal) {
  return proposal.groups.find((group) => group.key === component.target_group_key)?.name
    ?? proposal.items.find((item) => item.key === component.target_item_key)?.name
    ?? "Assessment";
}

function reviewWarnings(proposal: OutlineExtraction) {
  return proposal.warnings.filter(
    (warning) => !/^\d+ academic items? (?:has|have) no date\./.test(warning)
      && !/^Combined \d+ related files for this course\.$/.test(warning)
      && warning !== "No recurring class times were found. Add them in the next step.",
  );
}

function formatRule(component: GradingSchemeComponentProposal) {
  if (component.selection_rule === "drop_lowest_n") return `drop lowest ${component.selection_count ?? 1}`;
  if (component.selection_rule === "best_n") return `best ${component.selection_count ?? 1}`;
  if (component.selection_rule === "highest_attempt") return "highest-scoring attempt counts";
  if (component.selection_rule === "latest_attempt") return "latest attempt counts";
  return "all count";
}

function isAllocationDecisionRule(rule: GradingSchemeComponentProposal["selection_rule"]) {
  return rule === "best_n" || rule === "drop_lowest_n";
}

function isReplacementAttemptRule(rule: GradingSchemeComponentProposal["selection_rule"]) {
  return rule === "highest_attempt" || rule === "latest_attempt";
}

function formatOrigin(value: OutlineItemProposal["weight_origin"]) {
  return {
    explicit: "Explicit weight",
    inferred_equal: "Provisional equal share",
    calculated_from_points: "Calculated from points",
    inherited_from_group: "Inherited from group",
    manual: "Manually confirmed",
    unknown: "Weight unknown",
  }[value];
}

function formatPercent(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" });
}

function formatMonth(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-CA", { month: "long" });
}

function formatMonthYear(value: string) {
  return new Date(`${value.slice(0, 10)}T12:00:00`).toLocaleDateString("en-CA", { month: "short", year: "numeric" });
}

function isFinalExam(item: OutlineItemProposal) {
  return item.kind === "exam" && /\bfinal\b/i.test(item.name);
}

function weightsTotalOneHundred(weights: (number | null)[]) {
  return weights.length > 0
    && weights.every((weight) => weight !== null)
    && Math.abs(weights.reduce<number>((total, weight) => total + (weight ?? 0), 0) - 100) <= 0.01;
}
