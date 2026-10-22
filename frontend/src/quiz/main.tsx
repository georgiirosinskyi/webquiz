import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { getPageData } from "../shared/serverData";
import type { QuizPageData } from "./logic";
import { QuizApp } from "./QuizApp";
import "./quiz.css";

// The quiz page uses React only (no antd), so weak student devices load a small bundle
const page = getPageData<QuizPageData>({
  title: "WebQuiz",
  quizVersion: "",
  questions: [],
  showRightAnswer: true,
  showFinalList: true,
  usernameLabel: "",
  registrationFields: [],
  translations: {},
});

document.title = page.title;
// Relative to the page, so it works behind a reverse proxy prefix too
document.body.style.backgroundImage = "url('img/background.png')";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QuizApp page={page} />
  </StrictMode>,
);
