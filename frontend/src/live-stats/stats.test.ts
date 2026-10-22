import { describe, expect, it } from "vitest";
import {
  STATE_STYLES,
  computeStats,
  emptyState,
  filterUsers,
  formatTime,
  parseCompletionTime,
  reducer,
  type LiveState,
  type ServerMessage,
} from "./stats";

const questions = [
  { id: 1, question: "Q1", points: 0.1 },
  { id: 2, question: "Q2", points: 0.2 },
  { id: 3, question: "Q3", points: 0.7 },
];

function apply(...messages: ServerMessage[]): LiveState {
  return messages.reduce(reducer, emptyState);
}

const initial: ServerMessage = {
  type: "initial_state",
  users: { "100001": "alice" },
  live_stats: { "100001": { "1": { state: "think", time_taken: null } } },
  completed_users: { "100001": false },
  completion_times: {},
  questions,
  total_points: 1,
  current_quiz: "quiz.yaml",
};

describe("reducer", () => {
  it("loads the initial state", () => {
    const state = apply(initial);
    expect(state.users).toEqual({ "100001": "alice" });
    expect(state.totalPoints).toBe(1);
    expect(state.currentQuiz).toBe("quiz.yaml");
  });

  it("accepts the old live stats format with bare states", () => {
    const state = apply({ ...initial, live_stats: { "100001": { "1": "ok" } } } as ServerMessage);
    expect(state.liveStats["100001"]["1"]).toEqual({ state: "ok", time_taken: null });
  });

  it("adds registered users as in progress", () => {
    const state = apply(initial, {
      type: "user_registered",
      user_id: "100002",
      username: "bob",
      question_id: 1,
      state: "think",
      time_taken: null,
    });
    expect(state.users["100002"]).toBe("bob");
    expect(state.completed["100002"]).toBe(false);
    expect(state.liveStats["100002"]["1"].state).toBe("think");
  });

  it("marks a user completed with the completion time", () => {
    const state = apply(initial, {
      type: "state_update",
      user_id: "100001",
      question_id: 1,
      state: "ok",
      time_taken: 3,
      completed: true,
      completed_at: "21.10.2026 10:00:00",
    });
    expect(state.completed["100001"]).toBe(true);
    expect(state.completionTimes["100001"]).toBe("21.10.2026 10:00:00");
    expect(state.liveStats["100001"]["1"]).toEqual({ state: "ok", time_taken: 3 });
  });

  it("clears users and recomputes total points on quiz switch", () => {
    const state = apply(initial, {
      type: "quiz_switched",
      questions: [{ points: 2 }, {}],
      current_quiz: "other.yaml",
    });
    expect(state.users).toEqual({});
    expect(state.liveStats).toEqual({});
    expect(state.completionTimes).toEqual({});
    expect(state.totalPoints).toBe(3);
    expect(state.currentQuiz).toBe("other.yaml");
  });
});

describe("computeStats", () => {
  it("sums decimal points without float noise", () => {
    const state = apply({
      ...initial,
      live_stats: {
        "100001": {
          "1": { state: "ok", time_taken: 1 },
          "2": { state: "ok", time_taken: 1 },
          "3": { state: "fail", time_taken: 1 },
        },
      },
    } as ServerMessage);
    const stats = computeStats(state);
    expect(stats.users["100001"]).toEqual({ correct: 2, answered: 3, earnedPoints: 0.3 });
    expect(stats.questions[1]).toEqual({ correct: 1, attempts: 1 });
    expect(stats.questions[3]).toEqual({ correct: 0, attempts: 1 });
  });

  it("does not count thinking or skipped questions as attempts", () => {
    const state = apply({
      ...initial,
      live_stats: { "100001": { "1": { state: "skip", time_taken: null }, "2": { state: "think", time_taken: null } } },
    } as ServerMessage);
    const stats = computeStats(state);
    expect(stats.users["100001"].answered).toBe(0);
    expect(stats.questions[1].attempts).toBe(0);
  });
});

describe("filterUsers", () => {
  const state = apply({
    ...initial,
    users: { "100001": "alice", "100002": "bob", "100003": "carol" },
    completed_users: { "100001": true, "100002": false, "100003": true },
    completion_times: { "100001": "21.10.2026 09:00:00", "100003": "21.10.2026 10:30:00" },
  } as ServerMessage);

  it("counts every group", () => {
    expect(filterUsers(state, "all").counts).toEqual({ all: 3, inProgress: 1, completed: 2 });
  });

  it("sorts completed users newest first", () => {
    expect(filterUsers(state, "completed").visible).toEqual(["100003", "100001"]);
    expect(filterUsers(state, "inProgress").visible).toEqual(["100002"]);
  });
});

describe("helpers", () => {
  it("parses the server completion time format", () => {
    expect(parseCompletionTime("21.10.2026 10:30:05")).toBe(new Date(2026, 9, 21, 10, 30, 5).getTime());
    expect(parseCompletionTime(undefined)).toBeNaN();
  });

  it("formats answer times", () => {
    expect(formatTime(null)).toBeNull();
    expect(formatTime(-1)).toBeNull(); // timeout placeholder
    expect(formatTime(12.4)).toBe("12s");
    expect(formatTime(75)).toBe("1m 15s");
  });

  it("gives every cell state its own colors", () => {
    expect(STATE_STYLES.skip.background).toBe("#fff3cd"); // skipped questions are yellow
    expect(STATE_STYLES.fail.color).toBe("#721c24");
    const backgrounds = Object.values(STATE_STYLES).map((style) => style.background);
    expect(new Set(backgrounds).size).toBe(backgrounds.length);
  });
});
