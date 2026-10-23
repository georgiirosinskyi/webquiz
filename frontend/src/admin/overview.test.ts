import { describe, expect, it } from "vitest";
import {
  USER_SORTERS,
  answerRows,
  averagePercent,
  countUsers,
  fieldSorter,
  filterOverviewUsers,
  formatDuration,
  liveTimes,
  progressCells,
  progressSummary,
  registrationFieldNames,
  sortUsers,
  userNumbers,
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
  it("keeps registration order whatever the status", () => {
    expect(sortUsers(users).map((u) => u.user_id)).toEqual(["d", "a", "c", "b"]);
  });
});

describe("userNumbers", () => {
  it("numbers users by registration and keeps the number when the status changes", () => {
    const numbers = userNumbers(users);
    expect([...numbers.entries()]).toEqual([["d", 1], ["a", 2], ["c", 3], ["b", 4]]);
    const finished = upsertUser(users, user({ ...users[2], status: "completed" }), 1);
    expect(userNumbers(finished).get("c")).toBe(3);
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

describe("progressSummary", () => {
  it("counts correct, wrong, skipped and the rest", () => {
    const partly = user({
      question_order: [1, 2, 3, 4, 5],
      live_stats: {
        "1": { state: "ok", time_taken: 1 },
        "2": { state: "fail", time_taken: 1 },
        "3": { state: "skip", time_taken: null },
        "4": { state: "think", time_taken: null },
      },
    });
    expect(progressSummary(partly)).toEqual({ ok: 1, fail: 1, skip: 1, rest: 2 });
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

describe("USER_SORTERS", () => {
  const order = (list: AdminUser[], sorter: (a: AdminUser, b: AdminUser) => number) =>
    [...list].sort(sorter).map((u) => u.user_id);

  it("sorts progress by answers, then by correct answers", () => {
    const list = [
      user({ user_id: "a", answered: 3, correct: 1 }),
      user({ user_id: "b", answered: 5, correct: 0 }),
      user({ user_id: "c", answered: 3, correct: 3 }),
    ];
    expect(order(list, USER_SORTERS.progress)).toEqual(["a", "c", "b"]);
  });

  it("sorts names and fields like people read them", () => {
    const list = [user({ user_id: "a", username: "Олена", registration_fields: { class: "10-А" } }), user({ user_id: "b", username: "анна", registration_fields: { class: "9-А" } })];
    expect(order(list, USER_SORTERS.username)).toEqual(["b", "a"]);
    expect(order(list, fieldSorter("class"))).toEqual(["b", "a"]);
  });

  it("sorts grades as numbers, missing grades first", () => {
    const list = [user({ user_id: "a", mark: 10 }), user({ user_id: "b", mark: null }), user({ user_id: "c", mark: "9" })];
    expect(order(list, USER_SORTERS.mark)).toEqual(["b", "c", "a"]);
  });

  it("sorts status, points and time", () => {
    expect(order(users, USER_SORTERS.status)).toEqual(["b", "c", "a", "d"]);
    const list = [user({ user_id: "a", earned_points: 2, elapsed_seconds: 30 }), user({ user_id: "b", earned_points: 1, elapsed_seconds: null })];
    expect(order(list, USER_SORTERS.points)).toEqual(["b", "a"]);
    expect(order(list, USER_SORTERS.time)).toEqual(["b", "a"]);
  });
});
