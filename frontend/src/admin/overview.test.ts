import { describe, expect, it } from "vitest";
import {
  answerRows,
  averagePercent,
  countUsers,
  filterOverviewUsers,
  formatDuration,
  liveTimes,
  progressCells,
  registrationFieldNames,
  sortUsers,
  upsertUser,
} from "./overview";
import type { AdminUser, CurrentQuiz } from "./types";

function user(overrides: Partial<AdminUser>): AdminUser {
  return {
    user_id: "1",
    username: "User",
    registration_fields: {},
    status: "in_progress",
    answered: 0,
    correct: 0,
    skipped: 0,
    earned_points: 0,
    mark: null,
    points_percentage: null,
    elapsed_seconds: null,
    remaining_seconds: null,
    question_order: [1, 2, 3],
    live_stats: {},
    ...overrides,
  };
}

const users = [
  user({ user_id: "a", username: "Anna", status: "completed", points_percentage: 90, registered_at: "2026-01-01T10:00:00" }),
  user({ user_id: "b", username: "Bohdan", status: "pending", registration_fields: { class: "5-A" }, registered_at: "2026-01-01T10:05:00" }),
  user({ user_id: "c", username: "Olena", status: "in_progress", registration_fields: { class: "5-B" }, registered_at: "2026-01-01T10:01:00" }),
  user({ user_id: "d", username: "Petro", status: "time_up", points_percentage: 40, registered_at: "2026-01-01T09:00:00" }),
];

describe("sortUsers", () => {
  it("puts pending first, then in progress, then finished by registration time", () => {
    expect(sortUsers(users).map((u) => u.user_id)).toEqual(["b", "c", "d", "a"]);
  });
});

describe("countUsers", () => {
  it("counts each group, time_up is finished", () => {
    expect(countUsers(users)).toEqual({ all: 4, pending: 1, in_progress: 1, finished: 2 });
  });
});

describe("filterOverviewUsers", () => {
  it("filters by status group", () => {
    expect(filterOverviewUsers(users, "finished", "").map((u) => u.user_id)).toEqual(["a", "d"]);
    expect(filterOverviewUsers(users, "pending", "").map((u) => u.user_id)).toEqual(["b"]);
    expect(filterOverviewUsers(users, "all", "")).toHaveLength(4);
  });

  it("searches names and registration fields, case-insensitive", () => {
    expect(filterOverviewUsers(users, "all", "olE").map((u) => u.user_id)).toEqual(["c"]);
    expect(filterOverviewUsers(users, "all", "5-a").map((u) => u.user_id)).toEqual(["b"]);
  });
});

describe("averagePercent", () => {
  it("averages finished users only", () => {
    expect(averagePercent(users)).toBe(65);
  });

  it("is null when nobody finished", () => {
    expect(averagePercent([users[1]])).toBeNull();
  });
});

describe("liveTimes", () => {
  it("moves the timers on for a running test", () => {
    const running = user({ elapsed_seconds: 10, remaining_seconds: 50, received_at: 1000 });
    expect(liveTimes(running, 6000)).toEqual({ elapsed: 15, remaining: 45 });
    expect(liveTimes(running, 100000)).toEqual({ elapsed: 109, remaining: 0 });
  });

  it("keeps the times of a finished test", () => {
    const done = user({ status: "completed", elapsed_seconds: 30, received_at: 1000 });
    expect(liveTimes(done, 60000)).toEqual({ elapsed: 30, remaining: null });
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(75)).toBe("01:15");
    expect(formatDuration(3725)).toBe("1:02:05");
    expect(formatDuration(null)).toBe("—");
  });
});

describe("progressCells", () => {
  it("follows the user's question order", () => {
    const shuffled = user({ question_order: [3, 1, 2], live_stats: { "3": { state: "ok", time_taken: 2 }, "1": { state: "think", time_taken: null } } });
    expect(progressCells(shuffled)).toEqual([
      { id: 3, state: "ok" },
      { id: 1, state: "think" },
      { id: 2, state: "empty" },
    ]);
  });
});

describe("registrationFieldNames", () => {
  it("collects field names in order of appearance", () => {
    const withFields = [user({ registration_fields: { class: "1" } }), user({ registration_fields: { class: "2", school: "3" } })];
    expect(registrationFieldNames(withFields)).toEqual(["class", "school"]);
  });
});

describe("answerRows", () => {
  it("pairs the user's answers with the right ones in the user's order", () => {
    const quiz = {
      questions: [
        { id: 1, question: "2+2?", points: 1, correct_answer: ["4"] },
        { id: 2, question: "", image: "/imgs/map.png", points: 1, correct_answer: ["a", "c"] },
      ],
    } as unknown as CurrentQuiz;
    const answered = user({
      question_order: [2, 1],
      live_stats: { "2": { state: "fail", time_taken: 7 } },
      answers: { "2": ["a"] },
    });
    expect(answerRows(answered, quiz)).toEqual([
      { id: 2, position: 1, state: "fail", question: "map.png", answer: ["a"], correct: ["a", "c"], time_taken: 7 },
      { id: 1, position: 2, state: "empty", question: "2+2?", answer: null, correct: ["4"], time_taken: null },
    ]);
  });
});

describe("upsertUser", () => {
  it("replaces an existing record and appends a new one", () => {
    const updated = upsertUser(users, user({ user_id: "c", status: "completed" }), 5);
    expect(updated).toHaveLength(4);
    expect(updated[2]).toMatchObject({ status: "completed", received_at: 5 });
    expect(upsertUser(users, user({ user_id: "z" }), 5)).toHaveLength(5);
  });
});
