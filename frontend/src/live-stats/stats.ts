import { roundPoints } from "../shared/points";

export type CellState = "think" | "ok" | "fail" | "skip" | "empty";

export interface Cell {
  state: CellState;
  time_taken: number | null;
}

export interface Question {
  id?: number;
  question?: string;
  image?: string;
  file?: string;
  points?: number;
}

export interface LiveState {
  users: Record<string, string>; // user_id -> username
  liveStats: Record<string, Record<string, Cell>>; // user_id -> {question_id: cell}
  completed: Record<string, boolean>;
  completionTimes: Record<string, string>; // user_id -> "dd.mm.yyyy HH:MM:SS"
  questions: Question[];
  totalPoints: number;
  currentQuiz: string | null;
}

export type Filter = "all" | "inProgress" | "completed";

// Messages of /ws/live-stats (see websocket_live_stats and the
// broadcast_to_websockets calls in server.py).
export type ServerMessage =
  | {
      type: "initial_state";
      users?: Record<string, string>;
      live_stats?: Record<string, Record<string, Cell | CellState>>;
      completed_users?: Record<string, boolean>;
      completion_times?: Record<string, string>;
      questions?: Question[];
      total_points?: number;
      current_quiz?: string | null;
    }
  | {
      type: "user_registered";
      user_id: string;
      username: string;
      question_id: number;
      state: CellState;
      time_taken: number | null;
    }
  | {
      type: "state_update";
      user_id: string;
      question_id: number;
      state: CellState;
      time_taken: number | null;
      completed?: boolean;
      completed_at?: string | null;
    }
  | { type: "quiz_switched"; questions?: Question[]; current_quiz?: string | null }
  | { type: "pong" };

export const emptyState: LiveState = {
  users: {},
  liveStats: {},
  completed: {},
  completionTimes: {},
  questions: [],
  totalPoints: 0,
  currentQuiz: null,
};

// Background and text color of each cell state (skipped questions are yellow).
export const STATE_STYLES: Record<CellState, { background: string; color: string }> = {
  think: { background: "#cdeaff", color: "#044b85" },
  ok: { background: "#d4edda", color: "#155724" },
  fail: { background: "#f8d7da", color: "#721c24" },
  skip: { background: "#fff3cd", color: "#c4790f" },
  empty: { background: "#e9ecef", color: "#6c757d" },
};

export function questionPoints(question: Question | undefined): number {
  return question ? question.points || 1 : 1;
}

function sumPoints(questions: Question[]): number {
  return roundPoints(questions.reduce((sum, q) => sum + questionPoints(q), 0));
}

// Older servers sent only the state string instead of {state, time_taken}.
function normalizeLiveStats(
  liveStats: Record<string, Record<string, Cell | CellState>>,
): Record<string, Record<string, Cell>> {
  const normalized: Record<string, Record<string, Cell>> = {};
  for (const userId in liveStats) {
    normalized[userId] = {};
    for (const questionId in liveStats[userId]) {
      const value = liveStats[userId][questionId];
      normalized[userId][questionId] = typeof value === "string" ? { state: value, time_taken: null } : value;
    }
  }
  return normalized;
}

function setCell(state: LiveState, userId: string, questionId: number, cell: Cell): LiveState["liveStats"] {
  return { ...state.liveStats, [userId]: { ...state.liveStats[userId], [questionId]: cell } };
}

export function reducer(state: LiveState, message: ServerMessage): LiveState {
  switch (message.type) {
    case "initial_state": {
      const questions = message.questions || [];
      return {
        users: message.users || {},
        liveStats: normalizeLiveStats(message.live_stats || {}),
        completed: message.completed_users || {},
        completionTimes: message.completion_times || {},
        questions,
        totalPoints: roundPoints(message.total_points || sumPoints(questions)),
        currentQuiz: message.current_quiz || null,
      };
    }
    case "user_registered":
      return {
        ...state,
        users: { ...state.users, [message.user_id]: message.username },
        liveStats: setCell(state, message.user_id, message.question_id, {
          state: message.state,
          time_taken: message.time_taken,
        }),
        completed: { ...state.completed, [message.user_id]: false },
      };
    case "state_update": {
      const completed = message.completed || false;
      return {
        ...state,
        liveStats: setCell(state, message.user_id, message.question_id, {
          state: message.state,
          time_taken: message.time_taken,
        }),
        completed: { ...state.completed, [message.user_id]: completed },
        completionTimes:
          completed && message.completed_at
            ? { ...state.completionTimes, [message.user_id]: message.completed_at }
            : state.completionTimes,
      };
    }
    case "quiz_switched": {
      const questions = message.questions || [];
      return {
        ...emptyState,
        questions,
        totalPoints: sumPoints(questions),
        currentQuiz: message.current_quiz || null,
      };
    }
    default:
      return state;
  }
}

export interface UserStats {
  correct: number;
  answered: number;
  earnedPoints: number;
}

export interface QuestionStats {
  correct: number;
  attempts: number;
}

// Question ids are 1-based positions in the quiz file.
export function computeStats(state: LiveState): {
  users: Record<string, UserStats>;
  questions: Record<number, QuestionStats>;
} {
  const users: Record<string, UserStats> = {};
  const questions: Record<number, QuestionStats> = {};
  state.questions.forEach((_, index) => {
    questions[index + 1] = { correct: 0, attempts: 0 };
  });

  for (const userId in state.liveStats) {
    const stats: UserStats = { correct: 0, answered: 0, earnedPoints: 0 };
    for (const questionId in state.liveStats[userId]) {
      const cellState = state.liveStats[userId][questionId].state;
      if (cellState !== "ok" && cellState !== "fail") continue;
      const id = Number(questionId);
      const questionStats = (questions[id] ||= { correct: 0, attempts: 0 });
      stats.answered++;
      questionStats.attempts++;
      if (cellState === "ok") {
        stats.correct++;
        stats.earnedPoints += questionPoints(state.questions[id - 1]);
        questionStats.correct++;
      }
    }
    stats.earnedPoints = roundPoints(stats.earnedPoints);
    users[userId] = stats;
  }
  return { users, questions };
}

// "dd.mm.yyyy HH:MM:SS" (server format) -> sortable number, NaN if unknown.
export function parseCompletionTime(value: string | undefined): number {
  const match = value && /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value ? Date.parse(value) : NaN;
  const [, day, month, year, hours, minutes, seconds] = match.map(Number);
  return new Date(year, month - 1, day, hours, minutes, seconds).getTime();
}

// Users of the filter; completed users are sorted newest first.
export function filterUsers(state: LiveState, filter: Filter) {
  const all = Object.keys(state.users);
  const inProgress = all.filter((id) => !state.completed[id]);
  const completed = all
    .filter((id) => state.completed[id])
    .sort((a, b) => {
      const timeA = parseCompletionTime(state.completionTimes[a]);
      const timeB = parseCompletionTime(state.completionTimes[b]);
      if (!isNaN(timeA) && !isNaN(timeB)) return timeB - timeA;
      if (!isNaN(timeA)) return -1;
      if (!isNaN(timeB)) return 1;
      return 0;
    });
  const visible = filter === "inProgress" ? inProgress : filter === "completed" ? completed : all;
  return { visible, counts: { all: all.length, inProgress: inProgress.length, completed: completed.length } };
}

export function formatTime(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || seconds < 0) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
