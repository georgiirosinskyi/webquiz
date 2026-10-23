import type { MessageKey } from "../shared/i18n";
import type { AdminUser, CellState, CurrentQuiz, UserStatus } from "./types";

export type OverviewFilter = "all" | "pending" | "in_progress" | "finished";

export const STATUS_LABELS: Record<UserStatus, { key: MessageKey; color: string }> = {
  pending: { key: "status.pending", color: "gold" },
  in_progress: { key: "status.in_progress", color: "processing" },
  completed: { key: "status.completed", color: "success" },
  time_up: { key: "status.time_up", color: "error" },
};

// Status column order: waiting for approval, answering, finished
const STATUS_ORDER: Record<UserStatus, number> = { pending: 0, in_progress: 1, completed: 2, time_up: 2 };

export const isFinished = (user: AdminUser) => user.status === "completed" || user.status === "time_up";

// Registration order: a user keeps their place when the status changes (finishing does not move the row)
export function sortUsers(users: AdminUser[]): AdminUser[] {
  return [...users].sort((a, b) => (a.registered_at || "").localeCompare(b.registered_at || ""));
}

// Fixed number of every user (1, 2, ... in registration order), the same whatever the table is sorted or filtered by
export function userNumbers(users: AdminUser[]): Map<string, number> {
  return new Map(sortUsers(users).map((user, index) => [user.user_id, index + 1]));
}

export function countUsers(users: AdminUser[]): Record<OverviewFilter, number> {
  return {
    all: users.length,
    pending: users.filter((user) => user.status === "pending").length,
    in_progress: users.filter((user) => user.status === "in_progress").length,
    finished: users.filter(isFinished).length,
  };
}

// Search looks at the name and every registration field ("5-А" finds the whole class).
export function filterOverviewUsers(users: AdminUser[], filter: OverviewFilter, search: string): AdminUser[] {
  const term = search.trim().toLowerCase();
  return users.filter((user) => {
    if (filter === "finished" ? !isFinished(user) : filter !== "all" && user.status !== filter) return false;
    if (!term) return true;
    return [user.username, ...Object.values(user.registration_fields || {})].some((value) =>
      String(value).toLowerCase().includes(term),
    );
  });
}

// Mean points percentage of the users who finished, null when nobody has.
export function averagePercent(users: AdminUser[]): number | null {
  const values = users.filter(isFinished).map((user) => user.points_percentage ?? 0);
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

// The server sends timers as of the update; while the test runs they move on locally.
export function liveTimes(user: AdminUser, now: number): { elapsed: number | null; remaining: number | null } {
  const passed = user.status === "in_progress" && user.received_at ? Math.max(0, (now - user.received_at) / 1000) : 0;
  return {
    elapsed: user.elapsed_seconds === null ? null : Math.floor(user.elapsed_seconds + passed),
    remaining: user.remaining_seconds === null ? null : Math.max(0, Math.ceil(user.remaining_seconds - passed)),
  };
}

// 75 -> "01:15", 3725 -> "1:02:05"
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return "—";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${String(minutes).padStart(2, "0")}:${rest}`;
}

// State of each question in the order the user sees them.
export function progressCells(user: AdminUser): { id: number; state: CellState | "empty" }[] {
  return user.question_order.map((id) => ({ id, state: user.live_stats[String(id)]?.state || "empty" }));
}

// How many questions are correct, wrong, skipped and not answered yet.
export function progressSummary(user: AdminUser): Record<"ok" | "fail" | "skip" | "rest", number> {
  const summary = { ok: 0, fail: 0, skip: 0, rest: 0 };
  for (const cell of progressCells(user)) {
    if (cell.state === "ok" || cell.state === "fail" || cell.state === "skip") summary[cell.state] += 1;
    else summary.rest += 1;
  }
  return summary;
}

// Column sorters of the users table (ascending; antd reverses them for descending).
const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

// Grades are numbers or text ("A"); numbers sort numerically, a missing grade comes first
function compareMarks(a: AdminUser["mark"], b: AdminUser["mark"]): number {
  if (a === null || a === undefined || b === null || b === undefined) return (a == null ? 0 : 1) - (b == null ? 0 : 1);
  const numberA = Number(a);
  const numberB = Number(b);
  if (!Number.isNaN(numberA) && !Number.isNaN(numberB)) return numberA - numberB;
  return byText(String(a), String(b));
}

export const USER_SORTERS = {
  username: (a: AdminUser, b: AdminUser) => byText(a.username, b.username),
  status: (a: AdminUser, b: AdminUser) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  // More answers is further; with the same number of answers, more correct ones is further
  progress: (a: AdminUser, b: AdminUser) => a.answered - b.answered || a.correct - b.correct,
  points: (a: AdminUser, b: AdminUser) => a.earned_points - b.earned_points,
  mark: (a: AdminUser, b: AdminUser) => compareMarks(a.mark, b.mark),
  time: (a: AdminUser, b: AdminUser) => (a.elapsed_seconds ?? -1) - (b.elapsed_seconds ?? -1),
};

export const fieldSorter = (name: string) => (a: AdminUser, b: AdminUser) =>
  byText(a.registration_fields?.[name] || "", b.registration_fields?.[name] || "");

// Registration field names of all users, in the order they first appear.
export function registrationFieldNames(users: AdminUser[]): string[] {
  const names: string[] = [];
  for (const user of users) {
    for (const name of Object.keys(user.registration_fields || {})) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

export interface AnswerRow {
  id: number;
  position: number;
  state: CellState | "empty";
  question: string;
  answer: string[] | null;
  correct: string[];
  time_taken: number | null;
}

// One row per question in the user's order: what they answered (null if nothing) and the right answer.
export function answerRows(user: AdminUser, quiz: CurrentQuiz | null): AnswerRow[] {
  const questions = new Map((quiz?.questions || []).map((question) => [question.id, question]));
  return progressCells(user).map((cell, index) => {
    const question = questions.get(cell.id);
    return {
      ...cell,
      position: index + 1,
      question: question?.question || question?.image?.split("/").pop() || "",
      answer: user.answers?.[String(cell.id)] || null,
      correct: question?.correct_answer || [],
      time_taken: user.live_stats[String(cell.id)]?.time_taken ?? null,
    };
  });
}

// Applies one user record from the admin WebSocket to the list.
export function upsertUser(users: AdminUser[], user: AdminUser, receivedAt: number): AdminUser[] {
  const record = { ...user, received_at: receivedAt };
  const index = users.findIndex((existing) => existing.user_id === user.user_id);
  if (index === -1) return [...users, record];
  const next = [...users];
  next[index] = record;
  return next;
}
