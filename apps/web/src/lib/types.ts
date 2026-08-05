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
  name: string;
  kind: "assignment" | "exam" | "quiz" | "project" | "paper" | "lab" | "other";
  deadline_at: string | null;
  weight_percent: number | null;
  estimated_minutes: number;
  confidence: number;
  source_text: string;
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
  course: {
    code: string | null;
    name: string | null;
    instructor: string | null;
    confidence: number;
  };
  items: OutlineItemProposal[];
  meetings: OutlineMeetingProposal[];
  warnings: string[];
};
