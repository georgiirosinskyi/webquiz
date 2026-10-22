import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "../shared/AppProvider";
import { LiveStatsPage } from "./LiveStatsPage";
import "./live-stats.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <LiveStatsPage />
    </AppProvider>
  </StrictMode>,
);
