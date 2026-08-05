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
  created_at: string;
  updated_at: string;
};

export type Preferences = {
  id: string;
  minimum_sleep_minutes: number;
  preferred_sleep_minutes: number;
  default_wake_time: string;
  default_sleep_time: string;
  maximum_daily_focus_minutes: number;
  preferred_session_minutes: number;
  minimum_break_minutes: number;
  freeze_window_minutes: number;
  preserve_free_time_percent: number;
  auto_apply_low_impact_changes: boolean;
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
  category: string;
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
