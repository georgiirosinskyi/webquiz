import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "../shared/AppProvider";
import { FilesPage } from "./FilesPage";
import "../shared/admin.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <FilesPage />
    </AppProvider>
  </StrictMode>,
);
