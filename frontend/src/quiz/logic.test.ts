import { describe, expect, it } from "vitest";
import {
  answeredCount,
  applyQuestionOrder,
  applyServerState,
  deadlineFrom,
  formatPoints,
  formatTimer,
  initialQuestions,
  nextQuestionIndex,
  pickQuestionIndex,
  pointsWord,
  registrationProblem,
  registrationValues,
  relativePath,
  remainingSeconds,
  showNavigation,
  skipButtonMode,
  skipNeedsRequest,
  timerLevel,
  type QuizQuestion,
} from "./logic";

const base = initialQuestions([
  { id: 1, options: ["a", "b"] },
  { id: 2, options: ["a", "b"] },
  { id: 3, type: "text" },
  { id: 4, options: ["a", "b"] },
]);

function withStatuses(...statuses: QuizQuestion["status"][]): QuizQuestion[] {
  return base.map((question, i) => ({ ...question, status: statuses[i] }));
}

describe("question order and server state", () => {
  it("reorders by the server order", () => {
    expect(applyQuestionOrder(base, [3, 1, 4, 2]).map((q) => q.id)).toEqual([3, 1, 4, 2]);
  });

  it("keeps the order when the ids do not match", () => {
    expect(applyQuestionOrder(base, [1, 2]).map((q) => q.id)).toEqual([1, 2, 3, 4]);
  });

  it("restores answered and skipped questions", () => {
    const restored = applyServerState(base, { answered_questions: { "2": [0, 1], "3": "42" }, skipped_questions: [1] });
    expect(restored.map((q) => q.status)).toEqual(["skipped", "answered", "answered", "unseen"]);
    expect(restored[1].selectedAnswer).toEqual([0, 1]);
    expect(answeredCount(restored)).toBe(2);
  });
});

describe("navigation", () => {
  it("shows the suggested question unless it is answered", () => {
    expect(pickQuestionIndex(withStatuses("answered", "skipped", "unseen", "unseen"), 1)).toBe(1);
    expect(pickQuestionIndex(withStatuses("answered", "skipped", "unseen", "unseen"), 0)).toBe(2);
  });

  it("falls back to the first skipped question", () => {
    expect(pickQuestionIndex(withStatuses("answered", "skipped", "answered", "answered"), 0)).toBe(1);
  });

  it("goes to the next unanswered question, then wraps around", () => {
    expect(nextQuestionIndex(withStatuses("skipped", "answered", "unseen", "unseen"), 0)).toBe(2);
    expect(nextQuestionIndex(withStatuses("skipped", "answered", "answered", "answered"), 3)).toBe(0);
  });

  it("labels the skip button", () => {
    expect(skipButtonMode(withStatuses("unseen", "unseen", "unseen", "unseen"), 0, false)).toBe("hidden");
    expect(skipButtonMode(withStatuses("unseen", "unseen", "unseen", "unseen"), 3, true)).toBe("hidden");
    expect(skipButtonMode(withStatuses("unseen", "unseen", "unseen", "unseen"), 0, true)).toBe("skip");
    expect(skipButtonMode(withStatuses("answered", "unseen", "unseen", "unseen"), 0, true)).toBe("next");
    expect(skipButtonMode(withStatuses("skipped", "skipped", "unseen", "unseen"), 0, true)).toBe("next");
  });

  it("shows the navigation bar with skipping or when the config turns it on", () => {
    expect(showNavigation(false, false)).toBe(false);
    expect(showNavigation(false, true)).toBe(true);
    expect(showNavigation(true, false)).toBe(true);
  });

  it("sends a skip request only for a new unanswered question", () => {
    expect(skipNeedsRequest(withStatuses("unseen", "unseen", "unseen", "unseen"), 0)).toBe(true);
    expect(skipNeedsRequest(withStatuses("answered", "unseen", "unseen", "unseen"), 0)).toBe(false);
    expect(skipNeedsRequest(withStatuses("skipped", "skipped", "unseen", "unseen"), 0)).toBe(false);
  });
});

describe("formatting", () => {
  it("formats points and their word form", () => {
    expect(formatPoints(0.1 + 0.2)).toBe("0.3");
    expect(formatPoints(2)).toBe("2");
    const t = { points_2_4: "бали", points_other: "балів" };
    expect(pointsWord(3, t)).toBe("бали");
    expect(pointsWord(5, t)).toBe("балів");
    expect(pointsWord(2.5, t)).toBe("балів");
  });

  it("makes image paths relative for reverse proxies", () => {
    expect(relativePath("/imgs/a.png")).toBe("imgs/a.png");
    expect(relativePath("imgs/a.png")).toBe("imgs/a.png");
  });

  it("formats the timer and its warning levels", () => {
    expect(formatTimer(605)).toBe("10:05");
    expect(timerLevel(240)).toBe("");
    expect(timerLevel(180)).toBe("warning");
    expect(timerLevel(60)).toBe("danger");
  });

  it("computes the deadline from the server's remaining seconds", () => {
    expect(deadlineFrom(null, 10, 1000)).toBeNull();
    expect(deadlineFrom(600, undefined, 1000)).toBe(601000);
    expect(deadlineFrom(600, 30, 1000)).toBe(31000);
    expect(remainingSeconds(31000, 1000)).toBe(30);
    expect(remainingSeconds(31000, 31500)).toBe(0);
    expect(remainingSeconds(31000, 30100)).toBe(1); // rounds up
  });
});

describe("registration form", () => {
  const fields = [{ label: "Grade", name: "grade" }];
  const t = { please_enter_username: "name!", please_fill_field: 'fill "{field}"' };

  it("takes the name and the configured fields from the user data", () => {
    expect(registrationValues(fields, { username: "Ann", grade: "9", approved: false, user_id: "1" })).toEqual({
      username: "Ann",
      grade: "9",
    });
    expect(registrationValues(fields, undefined)).toEqual({ username: "", grade: "" });
  });

  it("names the first empty field", () => {
    expect(registrationProblem({ username: " ", grade: "9" }, fields, t)).toBe("name!");
    expect(registrationProblem({ username: "Ann", grade: "  " }, fields, t)).toBe('fill "Grade"');
    expect(registrationProblem({ username: "Ann", grade: "9" }, fields, t)).toBeNull();
  });
});
