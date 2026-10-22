import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "../shared/AppProvider";
import { AdminPage } from "./AdminPage";
import "../shared/admin.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <AdminPage />
    </AppProvider>
  </StrictMode>,
);
