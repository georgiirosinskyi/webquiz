// Pure logic of the quiz page, kept out of the components so it can be unit tested.
import type { Background } from "../shared/background";

export type QuestionStatus = "unseen" | "answered" | "skipped";

// A question as the server embeds it (without correct answers, see create_default_index_html)
export interface ClientQuestion {
  id: number;
  type?: "text";
  default_value?: string;
  options?: string[];
  is_multiple_choice?: boolean;
  min_correct?: number;
  points?: number;
  question?: string;
  image?: string;
  file?: string;
}

export type Answer = number | number[] | string;

export interface QuizQuestion extends ClientQuestion {
  status: QuestionStatus;
  selectedAnswer?: Answer;
}

// window.__WEBQUIZ__.page of the quiz page
export interface QuizPageData {
  title: string;
  quizVersion: string;
  questions: ClientQuestion[];
  showRightAnswer: boolean;
  showFinalList: boolean;
  usernameLabel: string;
  // options: the values to choose from, in this order (registration.field_options); none = free text
  registrationFields: { label: string; name: string; options?: string[] }[];
  translations: Record<string, string>;
  // config `question_navigation`: the question bar also when skipping is off
  questionNavigation?: boolean;
  // config `appearance`: page background color and optional image
  background?: Background;
}

// The parts of a verify-user response that restore the page after a reload
export interface ServerState {
  answered_questions?: Record<string, Answer>;
  skipped_questions?: number[];
}

export function initialQuestions(questions: ClientQuestion[]): QuizQuestion[] {
  return questions.map((question) => ({ ...question, status: "unseen" }));
}

// Reorder by the server's question_order (randomization); keep the order if the ids do not match
export function applyQuestionOrder(questions: QuizQuestion[], order: number[] | undefined): QuizQuestion[] {
  if (!order || order.length === 0) return questions;
  const reordered = order
    .map((id) => questions.find((question) => question.id === id))
    .filter((question): question is QuizQuestion => !!question);
  return reordered.length === questions.length ? reordered : questions;
}

// Answered and skipped questions from the server
export function applyServerState(questions: QuizQuestion[], state: ServerState): QuizQuestion[] {
  const answered = state.answered_questions || {};
  const skipped = state.skipped_questions || [];
  return questions.map((question) => {
    if (Object.prototype.hasOwnProperty.call(answered, String(question.id))) {
      return { ...question, status: "answered", selectedAnswer: answered[String(question.id)] };
    }
    if (skipped.includes(question.id)) return { ...question, status: "skipped" };
    return question;
  });
}

export function answeredCount(questions: QuizQuestion[]): number {
  return questions.filter((question) => question.status === "answered").length;
}

// Index of the question to show: the suggested one unless it is answered, else the first
// unanswered question not opened yet, else the first skipped one
export function pickQuestionIndex(questions: QuizQuestion[], suggested: number): number {
  if (suggested >= 0 && suggested < questions.length && questions[suggested].status !== "answered") return suggested;
  const unseen = questions.findIndex((question) => question.status === "unseen");
  if (unseen !== -1) return unseen;
  const unanswered = questions.findIndex((question) => question.status !== "answered");
  return unanswered !== -1 ? unanswered : Math.min(Math.max(suggested, 0), questions.length - 1);
}

// Next question without an answer; after the last one, the first one still unanswered
export function nextQuestionIndex(questions: QuizQuestion[], current: number): number {
  let next = current + 1;
  while (next < questions.length && questions[next].status === "answered") next++;
  return next < questions.length ? next : pickQuestionIndex(questions, -1);
}

// Label of the skip button: "Next" once the question is answered or the next one was opened
export function skipButtonMode(questions: QuizQuestion[], current: number, allowSkip: boolean): "hidden" | "skip" | "next" {
  if (!allowSkip || current >= questions.length - 1) return "hidden";
  return questions[current].status === "answered" || questions[current + 1].status !== "unseen" ? "next" : "skip";
}

// The numbered question bar: always with skipping (to come back to skipped questions),
// otherwise only when the config turns it on (`question_navigation`)
export function showNavigation(allowSkip: boolean, questionNavigation: boolean): boolean {
  return allowSkip || questionNavigation;
}

// Leaving with Skip sends /api/skip-question only for a new unanswered question
export function skipNeedsRequest(questions: QuizQuestion[], current: number): boolean {
  const nextUnseen = current < questions.length - 1 && questions[current + 1].status === "unseen";
  return questions[current].status !== "answered" && nextUnseen;
}

// Options starting with "/" are image paths
export const isImagePath = (value: string | undefined) => typeof value === "string" && value.startsWith("/");

// "/imgs/a.png" -> "imgs/a.png": the page may run under a reverse proxy prefix
export function relativePath(path: string): string {
  return path.startsWith("/") ? path.slice(1) : path;
}

// 0.30000000000000004 -> "0.3", 2 -> "2"
export function formatPoints(value: unknown): string {
  return String(Math.round((Number(value) || 0) * 100) / 100);
}

// Ukrainian: 2-4 points use another word form ("бали" vs "балів")
export function pointsWord(points: number, t: Record<string, string>): string {
  return Number.isInteger(points) && points >= 2 && points <= 4 ? t.points_2_4 : t.points_other;
}

export function formatTimer(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function timerLevel(seconds: number): "" | "warning" | "danger" {
  if (seconds <= 60) return "danger";
  if (seconds <= 180) return "warning";
  return "";
}

// Seconds left until a local deadline (computed from the server's remaining seconds,
// so a wrong clock on the device does not matter)
export function remainingSeconds(deadline: number, now: number): number {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function deadlineFrom(timeLimit: number | null | undefined, remaining: number | null | undefined, now: number) {
  if (!timeLimit) return null;
  return now + (remaining === undefined || remaining === null ? timeLimit : remaining) * 1000;
}

// Random token sent with a registration, so a retried request returns the same user.
// crypto.getRandomValues works without a secure context (randomUUID does not).
export function generateRequestToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type RegistrationField = QuizPageData["registrationFields"][number];

// The registration form values (name and configured fields) from the user data of the server
export function registrationValues(fields: RegistrationField[], data: Record<string, unknown> | undefined) {
  const values: Record<string, string> = { username: String(data?.username ?? "") };
  for (const field of fields) values[field.name] = String(data?.[field.name] ?? "");
  return values;
}

// The message for the first empty field of the registration form, or null
export function registrationProblem(
  values: Record<string, string>,
  fields: RegistrationField[],
  t: Record<string, string>,
): string | null {
  if (!(values.username || "").trim()) return t.please_enter_username;
  for (const field of fields) {
    const value = (values[field.name] || "").trim();
    if (!value) return t.please_fill_field.replace("{field}", field.label);
    if (field.options?.length && !field.options.includes(value)) return t.please_choose_field.replace("{field}", field.label);
  }
  return null;
}
