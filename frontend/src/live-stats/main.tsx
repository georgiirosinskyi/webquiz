import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "../shared/AppProvider";
import { t } from "../shared/i18n";
import { LiveStatsPage } from "./LiveStatsPage";
import "./live-stats.css";

document.title = `${t("live.title")} · WebQuiz`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <LiveStatsPage />
    </AppProvider>
  </StrictMode>,
);
