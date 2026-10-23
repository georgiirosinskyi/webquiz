import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConfigProvider } from "antd";
import { AppProvider } from "../shared/AppProvider";
import { backgroundStyle } from "../shared/background";
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
// Set on the body here: a relative url() in the CSS would resolve against the stylesheet
const background = backgroundStyle(page.background);
document.body.style.backgroundColor = background.backgroundColor;
document.body.style.backgroundImage = background.backgroundImage;
document.body.classList.toggle("dark-background", background.dark);
document.body.classList.toggle("image-background", !!background.backgroundImage);

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
