import { describe, expect, it } from "vitest";
import {
  changeQuestionType,
  fileNameError,
  folderNameError,
  formToQuiz,
  newQuestion,
  pointsError,
  questionErrors,
  quizErrors,
  quizToForm,
} from "./quizForm";

const quiz = {
  title: "Math",
  show_right_answer: false,
  show_answers_on_completion: true,
  randomize_questions: true,
  time_limit: 600,
  allow_skip_questions: true,
  marks: [{ grade: 5, min_score: 90 }],
  default_mark: 1,
  questions: [
    { question: "2+2?", options: ["3", "4"], correct_answer: 1, points: 0.5 },
    { image: "/imgs/a.png", options: ["A", "B", "C"], correct_answer: [0, 2], min_correct: 1 },
    { question: "Distance?", checker: "assert to_int(user_answer) == 5", correct_value: "5", custom: "keep" },
    { question: "Linked", options: ["x", "y"], correct_answer: 0, stick_to_the_previous: true },
  ],
};

describe("quizToForm / formToQuiz", () => {
  it("round-trips a quiz without losing data", () => {
    const form = quizToForm("grade5/math.yaml", quiz);
    expect(form.filename).toBe("math");
    expect(form.questions.map((q) => q.type)).toEqual(["single", "multiple", "text", "single"]);
    expect(formToQuiz(form)).toEqual({ ...quiz, show_final_list: true });
  });

  it("keeps unknown quiz and question keys", () => {
    const back = formToQuiz(quizToForm("q.yaml", quiz));
    expect(back.marks).toEqual(quiz.marks);
    expect(back.default_mark).toBe(1);
    expect((back.questions as Record<string, unknown>[])[2].custom).toBe("keep");
  });

  it("uses defaults for a new quiz", () => {
    const form = quizToForm("", null);
    expect(form).toMatchObject({ show_right_answer: true, show_final_list: true, randomize_questions: false });
    expect(form.questions).toHaveLength(1);
  });

  it("drops show_answers_on_completion while answers are shown after each question", () => {
    const form = { ...quizToForm("q", quiz), show_right_answer: true };
    expect(formToQuiz(form).show_answers_on_completion).toBe(false);
  });

  it("writes an empty checker for a text question without one", () => {
    const question = { ...newQuestion(), type: "text" as const, question: "Q", checker: "  ", correct_value: "42" };
    const back = formToQuiz({ ...quizToForm("q", null), questions: [question] });
    expect(back.questions).toEqual([{ question: "Q", default_value: "0", correct_value: "42", checker: "" }]);
  });

  it("rounds points and leaves out the default 1", () => {
    const base = quizToForm("q", { questions: [{ question: "Q", options: ["a", "b"], correct_answer: 0 }] });
    base.questions[0].points = 0.1 + 0.2;
    expect((formToQuiz(base).questions as Record<string, unknown>[])[0].points).toBe(0.3);
    base.questions[0].points = 1;
    expect((formToQuiz(base).questions as Record<string, unknown>[])[0]).not.toHaveProperty("points");
  });

  it("ignores min_correct above the number of correct answers", () => {
    const form = quizToForm("q", quiz);
    form.questions[1].min_correct = 5;
    expect((formToQuiz(form).questions as Record<string, unknown>[])[1]).not.toHaveProperty("min_correct");
  });
});

describe("validation", () => {
  it("checks points like the server", () => {
    expect(pointsError(1.25, 1)).toBeNull();
    expect(pointsError(0, 2)).toBe("Питання 2: бали мають бути більше 0");
    expect(pointsError(1.234, 3)).toBe("Питання 3: бали можуть мати не більше 2 знаків після коми");
    expect(pointsError("abc", 4)).toBe("Питання 4: бали мають бути числом");
  });

  it("names the question with missing content", () => {
    const empty = newQuestion();
    expect(questionErrors(empty, 3)).toEqual([
      "Питання 3: потрібен текст або зображення",
      "Питання 3: заповніть усі варіанти відповідей",
    ]);
  });

  it("requires a file name", () => {
    const form = quizToForm("", quiz);
    expect(quizErrors(form)).toEqual(["Будь ласка, введіть ім'я файлу"]);
  });

  it("takes only a name for the file: the folder is chosen in the list", () => {
    expect(fileNameError("math")).toBeNull();
    expect(fileNameError("  ")).toBe("Будь ласка, введіть ім'я файлу");
    expect(fileNameError("grade5/math")).toBe("Ім'я файлу не може містити теку (/ або \\): теку виберіть у списку тестів");
    expect(fileNameError("grade5\\math")).not.toBeNull();
    expect(fileNameError("..")).not.toBeNull();
    expect(quizErrors({ ...quizToForm("", quiz), filename: "a/b" })).toEqual([fileNameError("a/b")]);
  });

  it("checks a folder name the same way", () => {
    expect(folderNameError("grade5")).toBeNull();
    expect(folderNameError(" ")).toBe("Будь ласка, введіть назву теки");
    expect(folderNameError("a/b")).toBe("Назва теки не може містити / або \\");
    expect(folderNameError("a:b")).toBe("Назва теки містить недопустимі символи");
  });
});

describe("changeQuestionType", () => {
  it("keeps only the first correct answer for a single choice", () => {
    const question = { ...newQuestion(), type: "multiple" as const, options: ["a", "b", "c"], correct: [1, 2] };
    expect(changeQuestionType(question, "single").correct).toEqual([1]);
  });
});
