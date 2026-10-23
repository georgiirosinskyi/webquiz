import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { AppProvider } from "../shared/AppProvider";
import { getPageData } from "../shared/serverData";
import type { QuizPageData } from "./logic";
import { QuizApp } from "./QuizApp";
import "./quiz.css";

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

// Same antd theme as the admin pages; no animations, so questions switch at once
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <QuizApp page={page} />
      </ConfigProvider>
    </AppProvider>
  </StrictMode>,
);
