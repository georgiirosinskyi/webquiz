import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "../shared/AppProvider";
import { AdminApp } from "./AdminApp";
import "../shared/admin.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppProvider>
      <AdminApp />
    </AppProvider>
  </StrictMode>,
);
