export type User = {
  id: string;
  email: string;
  name: string;
  timezone: string;
  onboarding_completed_at: string | null;
  created_at: string;
};

export type Semester = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: "planned" | "active" | "completed" | "archived";
  created_at: string;
  updated_at: string;
};

export type Course = {
  id: string;
  semester_id: string;
  name: string;
  code: string;
  instructor: string | null;
  credits: number | null;
  current_grade: number | null;
  target_grade: number | null;
  difficulty: number;
  weekly_study_target_minutes: number;
  delivery_mode: "scheduled" | "asynchronous";
  first_content_available_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Goal = {
  id: string;
  name: string;
  description: string | null;
  semester_id: string | null;
  category: string;
  status: "active" | "paused" | "completed" | "archived";
  priority: "critical" | "high" | "medium" | "low" | "optional";
  start_date: string;
  target_date: string | null;
  target_description: string | null;
  minimum_weekly_minutes: number;
  preferred_weekly_minutes: number;
  maximum_weekly_minutes: number;
  minimum_session_minutes: number;
  preferred_session_minutes: number;
  maximum_session_minutes: number;
  preferred_sessions_per_week: number;
  maintenance_weekly_minutes: number;
  reducible_during_busy_weeks: boolean;
  progress_type: string | null;
  current_progress: number | null;
  target_progress: number | null;
  planning_kind: "goal" | "flexible_commitment";
  schedule_rule:
    | { cadence: "weekly"; target_minutes: number }
    | { cadence: "selected_days"; target_minutes: number; days_of_week: number[] }
    | null;
  created_at: string;
  updated_at: string;
};

export type Preferences = {
  id: string;
  minimum_sleep_minutes: number;
  default_wake_time: string;
  default_sleep_time: string;
  maximum_daily_focus_minutes: number;
  preferred_session_minutes: number;
  minimum_break_minutes: number;
  freeze_window_minutes: number;
  created_at: string;
  updated_at: string;
};

export type PlanningTask = {
  id: string;
  name: string;
  description: string | null;
  course_id: string | null;
  goal_id: string | null;
  academic_item_id: string | null;
  parent_task_id: string | null;
  status: "pending" | "in_progress" | "completed" | "skipped";
  priority: "critical" | "high" | "medium" | "low" | "optional";
  flexibility: "fixed" | "low" | "medium" | "high";
  intensity: "deep" | "moderate" | "light" | "administrative" | "passive";
  estimated_minutes: number;
  remaining_minutes: number;
  estimate_origin: "pending_exam" | "system_default" | "student_provided" | "manual";
  minimum_session_minutes: number;
  preferred_session_minutes: number;
  maximum_session_minutes: number;
  earliest_start_at: string | null;
  deadline_at: string | null;
  required: boolean;
  created_at: string;
  updated_at: string;
};

export type FixedEvent = {
  id: string;
  title: string;
  semester_id: string | null;
  course_id: string | null;
  meeting_kind: "lecture" | "lab" | "tutorial" | "seminar" | "studio" | "other" | null;
  category: string;
  priority: "critical" | "high" | "medium" | "low" | "optional";
  start_at: string;
  end_at: string;
  recurrence_rule: string | null;
  location: string | null;
  commute_before_minutes: number;
  commute_after_minutes: number;
  locked: boolean;
  created_at: string;
  updated_at: string;
};

export type AvailabilityWindow = {
  id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  type: "available" | "unavailable" | "preferred";
  energy_level: "high" | "medium" | "low";
  created_at: string;
  updated_at: string;
};

export type ScheduleBlock = {
  id: string;
  schedule_version_id: string;
  title: string;
  task_id: string | null;
  fixed_event_id: string | null;
  goal_id: string | null;
  start_at: string;
  end_at: string;
  block_type: "focus" | "commitment" | "goal" | "break" | "personal";
  locked: boolean;
  source: string;
  stability_weight: number;
  reason_code: string | null;
  reason_details: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type Schedule = {
  id: string;
  semester_id: string;
  version_number: number;
  reason: string;
  status: "proposed" | "accepted" | "rejected" | "superseded";
  accepted_at: string | null;
  blocks: ScheduleBlock[];
  created_at: string;
  updated_at: string;
};

export type ScheduleProposal = Schedule & {
  base_schedule_version_id: string | null;
  revision_of_proposal_id: string | null;
  horizon_start: string;
  horizon_end: string;
  stale: boolean;
  generation_summary: {
    solve_status: "optimal" | "feasible" | "infeasible";
    coverage_status: "complete" | "partial";
    timed_out: boolean;
    used_baseline: boolean;
    scheduled_minutes: number;
    requested_minutes: number;
    eligible_capacity_minutes: number;
    protected_free_minutes: number;
    solver_runtime_ms: number;
    academic_requested_minutes: number;
    academic_scheduled_minutes: number;
    opportunistic_scheduled_minutes: number;
    exam_preparation: Record<string, unknown>[];
    flexible_adjustments: Record<string, unknown>[];
    rollover_by_day: Record<string, unknown>[];
    extra_focus_by_day: Record<string, unknown>[];
    sleep_by_day: Record<string, unknown>[];
    preserved_blocks: number;
    generated_blocks: number;
    moved_blocks: number;
    warnings: string[];
    unscheduled: {
      id: string;
      name: string;
      remaining_minutes: number;
      reason_code?: string;
      reason: string;
    }[];
  };
  revision_feedback: {
    interpreter: "openai" | "fallback";
    note_applied: boolean;
    summary: string;
    policy: Record<string, unknown>;
    changes?: {
      blocks_changed: number;
      block_count_delta: number;
      scheduled_minutes_delta: number;
    };
  } | null;
};

export type ScheduleGenerationRequirements = {
  horizon_start: string;
  horizon_end: string;
  exams: {
    academic_item_id: string;
    task_id: string;
    course_code: string;
    name: string;
    due_at: string;
    default_minutes: number;
  }[];
  blocking_inputs: { code: string; message: string; course_id: string | null }[];
};

export type ScheduleRevisionReason =
  | "too_packed"
  | "wrong_times"
  | "sessions_too_long"
  | "sessions_too_short"
  | "balance_activities"
  | "other";

export type PlanningEntry = {
  id: string;
  kind: "scheduled_block" | "fixed_event";
  source_id: string;
  title: string;
  start_at: string;
  end_at: string;
  block_type: string;
  category: string;
  location: string | null;
  task_id: string | null;
  task_status: PlanningTask["status"] | null;
  goal_id: string | null;
  course_code: string | null;
  locked: boolean;
  recurring: boolean;
  editable: boolean;
};

export type PlannerTask = {
  id: string;
  name: string;
  remaining_minutes: number;
  deadline_at: string | null;
  priority: PlanningTask["priority"];
  intensity: PlanningTask["intensity"];
  course_code: string | null;
  goal_name: string | null;
};

export type PlanningCapacity = {
  available_minutes: number;
  commitment_minutes: number;
  usable_focus_minutes: number;
  planned_focus_minutes: number;
  protected_free_minutes: number;
  remaining_focus_minutes: number;
  derived_preferred_sleep_minutes: number;
};

export type PlanningView = {
  start_date: string;
  end_date: string;
  timezone: string;
  entries: PlanningEntry[];
  days: { date: string; capacity: PlanningCapacity }[];
  unscheduled_tasks: PlannerTask[];
  next_entry_id: string | null;
  warnings: string[];
};

export type SemesterPlanning = {
  semester: Semester;
  total_demand_minutes: number;
  total_capacity_minutes: number;
  open_capacity_minutes: number;
  upcoming_deadlines: number;
  incomplete_data: boolean;
  weeks: {
    week_number: number;
    start_date: string;
    end_date: string;
    demand_minutes: number;
    capacity_minutes: number;
    commitment_minutes: number;
    scheduled_minutes: number;
    load_percent: number | null;
    risk: "low" | "medium" | "high" | "unknown";
  }[];
  deadlines: {
    id: string;
    name: string;
    due_at: string;
    course_code: string | null;
    remaining_minutes: number | null;
    weight_percent: number | null;
  }[];
};

export type OutlineItemProposal = {
  key: string | null;
  group_key: string | null;
  name: string;
  kind: "assignment" | "exam" | "quiz" | "project" | "paper" | "lab" | "other";
  deadline_at: string | null;
  weight_percent: number | null;
  relative_weight_percent: number | null;
  points_possible: number | null;
  weight_origin: WeightOrigin;
  minimum_required_percent: number | null;
  extra_credit: boolean;
  estimated_minutes: number;
  confidence: number;
  source_text: string;
};

export type WeightOrigin =
  | "explicit"
  | "inferred_equal"
  | "calculated_from_points"
  | "inherited_from_group"
  | "manual"
  | "unknown";

export type AllocationMethod = "equal" | "explicit_percent" | "points";
export type SelectionRule =
  | "all"
  | "best_n"
  | "drop_lowest_n"
  | "highest_attempt"
  | "latest_attempt";

export type AssessmentGroupProposal = {
  key: string;
  parent_key: string | null;
  name: string;
  allocation_method: AllocationMethod;
  relative_weight_percent: number | null;
  weight_origin: WeightOrigin;
  extraction_confidence: number;
  source_text: string | null;
};

export type GradingSchemeComponentProposal = {
  target_group_key: string | null;
  target_item_key: string | null;
  weight_percent: number;
  selection_rule: SelectionRule;
  selection_count: number | null;
  is_extra_credit: boolean;
  minimum_required_percent: number | null;
};

export type GradingSchemeProposal = {
  key: string;
  name: string;
  selection_mode: "fixed" | "best_outcome" | "student_selected";
  is_primary: boolean;
  is_complete: boolean;
  components: GradingSchemeComponentProposal[];
};

export type OutlineMeetingProposal = {
  title: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  location: string | null;
  confidence: number;
  source_text: string;
};

export type OutlineExtraction = {
  file_name: string;
  source_files: string[];
  document_types: ("course_outline" | "course_schedule" | "lecture_material" | "unknown")[];
  course: {
    code: string | null;
    name: string | null;
    instructor: string | null;
    confidence: number;
  };
  items: OutlineItemProposal[];
  groups: AssessmentGroupProposal[];
  schemes: GradingSchemeProposal[];
  grading_evidence: string[];
  meetings: OutlineMeetingProposal[];
  warnings: string[];
};

export type CourseOutlineImportResult = {
  course: Course;
  updated_existing: boolean;
  meetings_created: number;
};

export type AssessmentGroup = {
  id: string;
  parent_group_id: string | null;
  name: string;
  allocation_method: AllocationMethod;
  relative_weight_percent: number | null;
  weight_origin: WeightOrigin;
  extraction_confidence: number;
  source_text: string | null;
};

export type AcademicItem = {
  id: string;
  course_id: string;
  assessment_group_id: string | null;
  task_id: string | null;
  item_type:
    | "assignment"
    | "project"
    | "quiz"
    | "midterm"
    | "final_exam"
    | "presentation"
    | "reading"
    | "lab"
    | "other";
  name: string;
  description: string | null;
  due_at: string | null;
  direct_weight_percent: number | null;
  relative_weight_percent: number | null;
  points_possible: number | null;
  points_earned: number | null;
  grade_status: "ungraded" | "graded" | "exempt" | "missed";
  weight_origin: WeightOrigin;
  extraction_confidence: number;
  minimum_required_percent: number | null;
  extra_credit: boolean;
  source_text: string | null;
  source_references: string[];
};

export type GradingScheme = {
  id: string;
  name: string;
  selection_mode: "fixed" | "best_outcome" | "student_selected";
  is_primary: boolean;
  is_complete: boolean;
  components: Array<{
    id: string;
    assessment_group_id: string | null;
    academic_item_id: string | null;
    weight_percent: number;
    selection_rule: SelectionRule;
    selection_count: number | null;
    is_extra_credit: boolean;
    minimum_required_percent: number | null;
  }>;
};

export type CourseGrading = {
  course: Course;
  groups: AssessmentGroup[];
  items: AcademicItem[];
  schemes: GradingScheme[];
  warnings: string[];
};

export type AcademicImpact = {
  academic_item_id: string;
  task_id: string | null;
  tier: "critical" | "high" | "normal" | "low";
  effective_weight_percent: number;
  minimum_weight_percent: number;
  maximum_weight_percent: number;
  weight_origin: WeightOrigin;
  blocking_rule: string | null;
  reasons: Array<{ code: string; label: string }>;
};
