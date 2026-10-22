// Requests of the quiz page. Requests that fail because the connection dropped are repeated
// until they get through, with a banner while the page waits. A repeated answer or registration
// is safe: the server returns the stored result if the first attempt got through.

export const RETRY_DELAYS_MS = [1000, 2000, 4000, 5000]; // The last delay repeats
export const REQUEST_TIMEOUT_MS = 15000;
const RETRY_STATUSES = [502, 503, 504]; // A proxy or the tunnel cannot reach the server

export interface ConnectionHooks {
  quizVersion: string;
  onWaitingChange: (change: 1 | -1) => void; // Banner while requests wait for the connection
  onQuizChanged: () => void; // The server switched to another quiz: reload the page
  sleep?: (ms: number) => Promise<void>;
}

// The page embeds the questions of one quiz. Every request carries its version, so after a
// quiz switch or restart the server refuses answers to the old questions and the page reloads.
export function withQuizVersion(url: string, quizVersion: string): string {
  if (!quizVersion || !url.startsWith("api/")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}quiz_version=${encodeURIComponent(quizVersion)}`;
}

async function isQuizChangedResponse(response: Response): Promise<boolean> {
  try {
    return !!(await response.clone().json()).quiz_changed;
  } catch {
    return false;
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createFetchWithRetry(hooks: ConnectionHooks) {
  const sleep = hooks.sleep || defaultSleep;

  return async function fetchWithRetry(url: string, options: RequestInit = {}): Promise<Response> {
    let attempt = 0;
    let waiting = false;
    const target = withQuizVersion(url, hooks.quizVersion);
    try {
      for (;;) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        try {
          const response = await fetch(target, { ...options, signal: controller.signal });
          if (response.status === 409 && (await isQuizChangedResponse(response))) {
            hooks.onQuizChanged();
            return new Promise<Response>(() => {}); // The page is reloading
          }
          if (!RETRY_STATUSES.includes(response.status)) return response;
        } catch (error) {
          console.log(`Request to ${target} failed, retrying:`, error);
        } finally {
          clearTimeout(timer);
        }
        if (!waiting) {
          waiting = true;
          hooks.onWaitingChange(1);
        }
        await sleep(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]);
        attempt++;
      }
    } finally {
      if (waiting) hooks.onWaitingChange(-1);
    }
  };
}

export type FetchWithRetry = ReturnType<typeof createFetchWithRetry>;

const RELOAD_GUARD_KEY = "quizReloadFrom";

// Reload once for a new quiz. If a reload already brought back this same page (e.g. a cached
// copy), do not loop: returns false and the page asks the student to reload by hand.
export function shouldReloadForNewQuiz(quizVersion: string): boolean {
  let reloadedFrom: string | null = null;
  try {
    reloadedFrom = sessionStorage.getItem(RELOAD_GUARD_KEY);
    sessionStorage.setItem(RELOAD_GUARD_KEY, quizVersion);
  } catch {
    // Storage may be unavailable, the reload still works
  }
  return reloadedFrom !== quizVersion;
}
