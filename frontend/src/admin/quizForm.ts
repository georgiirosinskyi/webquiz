import { roundPoints } from "../shared/points";

// Quiz YAML (as parsed JSON) <-> values of the quiz editor form.
// Keys the editor does not know (marks, default_mark, future options, ...)
// are kept in `extra` and written back unchanged, so saving from the editor
// never drops settings that were added to the YAML by hand.

export type QuestionType = "single" | "multiple" | "text";

export interface QuestionForm {
  type: QuestionType;
  question: string;
  image: string;
  file: string;
  options: string[];
  correct: number[]; // indices of correct options (one for "single")
  min_correct: number | null;
  default_value: string;
  correct_value: string;
  checker: string;
  points: number | null;
  stick_to_the_previous: boolean;
  extra: Record<string, unknown>;
}

export interface QuizForm {
  filename: string;
  title: string;
  show_right_answer: boolean;
  show_answers_on_completion: boolean;
  randomize_questions: boolean;
  show_final_list: boolean;
  allow_skip_questions: boolean;
  time_limit: number | null; // seconds, 0/empty = no limit
  questions: QuestionForm[];
  extra: Record<string, unknown>;
}

type Json = Record<string, unknown>;

const QUESTION_KEYS = [
  "question",
  "image",
  "file",
  "options",
  "correct_answer",
  "min_correct",
  "default_value",
  "correct_value",
  "checker",
  "points",
  "stick_to_the_previous",
];

const QUIZ_KEYS = [
  "title",
  "show_right_answer",
  "show_answers_on_completion",
  "randomize_questions",
  "show_final_list",
  "allow_skip_questions",
  "time_limit",
  "questions",
];

function pickExtra(source: Json, known: string[]): Json {
  return Object.fromEntries(Object.entries(source).filter(([key]) => !known.includes(key)));
}

const str = (value: unknown) => (value === undefined || value === null ? "" : String(value));

export function newQuestion(): QuestionForm {
  return {
    type: "single",
    question: "",
    image: "",
    file: "",
    options: ["", ""],
    correct: [0],
    min_correct: null,
    default_value: "0",
    correct_value: "1000",
    checker: 'assert 900 < to_int(user_answer) < 1100, "Вийшли за рамки"',
    points: 1,
    stick_to_the_previous: false,
    extra: {},
  };
}

export function questionToForm(question: Json): QuestionForm {
  const isText = "checker" in question;
  const correct = question.correct_answer;
  const isMultiple = !isText && Array.isArray(correct);
  return {
    type: isText ? "text" : isMultiple ? "multiple" : "single",
    question: str(question.question),
    image: str(question.image),
    file: str(question.file),
    options: Array.isArray(question.options) ? question.options.map(str) : isText ? [] : ["", ""],
    correct: isMultiple ? (correct as number[]).map(Number) : [Number(correct) || 0],
    min_correct: typeof question.min_correct === "number" ? question.min_correct : null,
    default_value: str(question.default_value),
    correct_value: str(question.correct_value),
    checker: str(question.checker),
    points: typeof question.points === "number" ? question.points : 1,
    stick_to_the_previous: question.stick_to_the_previous === true,
    extra: pickExtra(question, QUESTION_KEYS),
  };
}

export function quizToForm(filename: string, quiz: Json | null): QuizForm {
  const data = quiz || {};
  const questions = Array.isArray(data.questions) ? (data.questions as Json[]) : [];
  return {
    filename: filename.replace(/\.ya?ml$/, ""),
    title: str(data.title),
    show_right_answer: data.show_right_answer !== false,
    show_answers_on_completion: data.show_answers_on_completion === true,
    randomize_questions: data.randomize_questions === true,
    show_final_list: data.show_final_list !== false,
    allow_skip_questions: data.allow_skip_questions === true,
    time_limit: typeof data.time_limit === "number" ? data.time_limit : null,
    questions: questions.length > 0 ? questions.map(questionToForm) : [newQuestion()],
    extra: pickExtra(data, QUIZ_KEYS),
  };
}

export function questionToQuiz(form: QuestionForm): Json {
  const question: Json = { ...form.extra };
  if (form.type === "text") {
    if (form.default_value) question.default_value = form.default_value;
    if (form.correct_value) question.correct_value = form.correct_value;
    // The checker key marks a text question; empty means exact match with correct_value
    question.checker = form.checker.trim() ? form.checker : "";
  } else {
    question.options = form.options.map((option) => option.trim());
    const correct = [...new Set(form.correct)].filter((i) => i < form.options.length).sort((a, b) => a - b);
    if (form.type === "multiple") {
      question.correct_answer = correct.length > 0 ? correct : [0];
      const minCorrect = Number(form.min_correct);
      if (minCorrect > 0 && minCorrect <= correct.length) question.min_correct = minCorrect;
    } else {
      question.correct_answer = correct[0] ?? 0;
    }
  }
  if (form.question.trim()) question.question = form.question.trim();
  if (form.image.trim()) question.image = form.image.trim();
  if (form.file.trim()) question.file = form.file.trim();
  const points = roundPoints(form.points ?? 1);
  if (points > 0 && points !== 1) question.points = points;
  if (form.stick_to_the_previous) question.stick_to_the_previous = true;
  return question;
}

export function formToQuiz(form: QuizForm): Json {
  const quiz: Json = { ...form.extra, questions: form.questions.map(questionToQuiz) };
  if (form.title.trim()) quiz.title = form.title.trim();
  quiz.show_right_answer = form.show_right_answer;
  quiz.randomize_questions = form.randomize_questions;
  // Only meaningful when the right answer is not shown after each question
  quiz.show_answers_on_completion = !form.show_right_answer && form.show_answers_on_completion;
  quiz.show_final_list = form.show_final_list;
  if (form.allow_skip_questions) quiz.allow_skip_questions = true;
  if (form.time_limit && form.time_limit > 0) quiz.time_limit = Math.round(form.time_limit);
  return quiz;
}

// Same rule as the server: a number > 0 with at most 2 decimal places.
export function pointsError(value: unknown, questionNumber: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  const points = Number(value);
  if (isNaN(points)) return `Питання ${questionNumber}: бали мають бути числом`;
  if (points <= 0) return `Питання ${questionNumber}: бали мають бути більше 0`;
  if (roundPoints(points) !== points) return `Питання ${questionNumber}: бали можуть мати не більше 2 знаків після коми`;
  return null;
}

// Problems that block saving, each naming the question.
export function questionErrors(form: QuestionForm, questionNumber: number): string[] {
  const errors: string[] = [];
  if (!form.question.trim() && !form.image.trim()) {
    errors.push(`Питання ${questionNumber}: потрібен текст або зображення`);
  }
  if (form.type !== "text") {
    if (form.options.length < 2) errors.push(`Питання ${questionNumber}: потрібно принаймні 2 варіанти`);
    if (form.options.some((option) => !option.trim())) {
      errors.push(`Питання ${questionNumber}: заповніть усі варіанти відповідей`);
    }
    if (form.type === "multiple" && form.correct.length === 0) {
      errors.push(`Питання ${questionNumber}: позначте принаймні одну правильну відповідь`);
    }
  }
  const points = pointsError(form.points, questionNumber);
  if (points) errors.push(points);
  return errors;
}

export function quizErrors(form: QuizForm): string[] {
  const errors: string[] = [];
  if (!form.filename.trim()) errors.push("Будь ласка, введіть ім'я файлу");
  if (form.questions.length === 0) errors.push("Будь ласка, додайте принаймні одне питання");
  form.questions.forEach((question, index) => errors.push(...questionErrors(question, index + 1)));
  return errors;
}

// Switching the type keeps what still makes sense.
export function changeQuestionType(form: QuestionForm, type: QuestionType): QuestionForm {
  if (type === form.type) return form;
  const next = { ...form, type };
  if (type === "single") next.correct = [form.correct[0] ?? 0];
  if (type !== "text" && next.options.length < 2) next.options = [...next.options, "", ""].slice(0, 2);
  return next;
}
