import type { MessageKey } from "../shared/i18n";
import type { LiveState } from "../live-stats/stats";
import type { AdminUser, CellState, CurrentQuiz, UserStatus } from "./types";

export type OverviewFilter = "all" | "pending" | "in_progress" | "finished";

export const STATUS_LABELS: Record<UserStatus, { key: MessageKey; color: string }> = {
  pending: { key: "status.pending", color: "gold" },
  in_progress: { key: "status.in_progress", color: "processing" },
  completed: { key: "status.completed", color: "success" },
  time_up: { key: "status.time_up", color: "error" },
};

// Pending users first (they need the admin), then those still answering, then finished ones
const STATUS_ORDER: Record<UserStatus, number> = { pending: 0, in_progress: 1, completed: 2, time_up: 2 };

export const isFinished = (user: AdminUser) => user.status === "completed" || user.status === "time_up";

export function sortUsers(users: AdminUser[]): AdminUser[] {
  return [...users].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.registered_at || "").localeCompare(b.registered_at || ""),
  );
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

// The overview users as live stats state, for the questions x users matrix (pending users are not in it).
export function toLiveState(users: AdminUser[], quiz: CurrentQuiz | null): LiveState {
  const started = users.filter((user) => user.status !== "pending");
  return {
    users: Object.fromEntries(started.map((user) => [user.user_id, user.username])),
    liveStats: Object.fromEntries(started.map((user) => [user.user_id, user.live_stats])),
    completed: Object.fromEntries(started.map((user) => [user.user_id, isFinished(user)])),
    completionTimes: {},
    questions: (quiz?.questions || []).map((question) => ({ ...question, image: question.image || undefined })),
    totalPoints: quiz?.total_points || 0,
    currentQuiz: quiz?.filename || null,
  };
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
