import { afterEach, describe, expect, it, vi } from "vitest";
import { createFetchWithRetry, shouldReloadForNewQuiz, withQuizVersion } from "./connection";

function jsonResponse(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function setup(responses: (Response | Error)[]) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(url);
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next!;
  });
  vi.stubGlobal("fetch", fetchMock);
  const waiting: number[] = [];
  const onQuizChanged = vi.fn();
  const sleeps: number[] = [];
  const fetchWithRetry = createFetchWithRetry({
    quizVersion: "v1",
    onWaitingChange: (change) => waiting.push(change),
    onQuizChanged,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { fetchWithRetry, calls, waiting, onQuizChanged, sleeps };
}

afterEach(() => vi.unstubAllGlobals());

describe("withQuizVersion", () => {
  it("adds the version to API requests only", () => {
    expect(withQuizVersion("api/register", "v 1")).toBe("api/register?quiz_version=v%201");
    expect(withQuizVersion("api/verify-user/1?x=1", "v1")).toBe("api/verify-user/1?x=1&quiz_version=v1");
    expect(withQuizVersion("imgs/a.png", "v1")).toBe("imgs/a.png");
    expect(withQuizVersion("api/register", "")).toBe("api/register");
  });
});

describe("fetchWithRetry", () => {
  it("returns the first response that is not a connection problem", async () => {
    const { fetchWithRetry, calls, waiting } = setup([jsonResponse(400, { error: "bad" })]);
    const response = await fetchWithRetry("api/register", { method: "POST" });
    expect(response.status).toBe(400);
    expect(calls).toEqual(["api/register?quiz_version=v1"]);
    expect(waiting).toEqual([]);
  });

  it("retries network errors and gateway errors with growing delays and a banner", async () => {
    const { fetchWithRetry, calls, waiting, sleeps } = setup([
      new TypeError("Failed to fetch"),
      jsonResponse(502),
      jsonResponse(503),
      jsonResponse(504),
      jsonResponse(504),
      jsonResponse(200, { ok: true }),
    ]);
    const response = await fetchWithRetry("api/submit-answer");
    expect(await response.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(6);
    expect(sleeps).toEqual([1000, 2000, 4000, 5000, 5000]);
    expect(waiting).toEqual([1, -1]); // one banner for the whole wait
  });

  it("asks to reload when the server switched to another quiz", async () => {
    const { fetchWithRetry, onQuizChanged } = setup([jsonResponse(409, { quiz_changed: true })]);
    const pending = fetchWithRetry("api/submit-answer");
    await vi.waitFor(() => expect(onQuizChanged).toHaveBeenCalled());
    const settled = await Promise.race([pending.then(() => "settled"), Promise.resolve("pending")]);
    expect(settled).toBe("pending"); // never resolves: the page reloads
  });

  it("returns other 409 responses", async () => {
    const { fetchWithRetry, onQuizChanged } = setup([jsonResponse(409, { error: "answered" })]);
    expect((await fetchWithRetry("api/submit-answer")).status).toBe(409);
    expect(onQuizChanged).not.toHaveBeenCalled();
  });
});

describe("shouldReloadForNewQuiz", () => {
  it("reloads once per quiz version", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
    });
    expect(shouldReloadForNewQuiz("v1")).toBe(true);
    expect(shouldReloadForNewQuiz("v1")).toBe(false);
    expect(shouldReloadForNewQuiz("v2")).toBe(true);
  });

  it("still reloads without storage", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
    });
    expect(shouldReloadForNewQuiz("v1")).toBe(true);
  });
});
