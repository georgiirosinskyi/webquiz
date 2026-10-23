import { useEffect, useState } from "react";

// Sections of the admin app. The server serves the same page for /admin/, /admin/{section}
// and /files/ (the old file manager URL), the app picks the section from the path.
export type Section = "overview" | "quizzes" | "files" | "settings" | "access";

export const SECTION_PATHS: Record<Section, string> = {
  overview: "/admin/",
  quizzes: "/admin/quizzes",
  files: "/admin/files",
  settings: "/admin/settings",
  access: "/admin/access",
};

export function sectionFromPath(pathname: string): Section {
  if (pathname.startsWith("/files")) return "files";
  const name = pathname.replace(/^\/admin\/?/, "").replace(/\/+$/, "");
  const section = (Object.keys(SECTION_PATHS) as Section[]).find((key) => key !== "overview" && key === name);
  return section || "overview";
}

const listeners = new Set<() => void>();

export function navigate(section: Section) {
  const path = SECTION_PATHS[section];
  if (window.location.pathname !== path) window.history.pushState(null, "", path);
  listeners.forEach((listener) => listener());
}

// Current section; follows navigate() and the browser back/forward buttons.
export function useSection(): Section {
  const [section, setSection] = useState(() => sectionFromPath(window.location.pathname));
  useEffect(() => {
    const update = () => setSection(sectionFromPath(window.location.pathname));
    listeners.add(update);
    window.addEventListener("popstate", update);
    return () => {
      listeners.delete(update);
      window.removeEventListener("popstate", update);
    };
  }, []);
  return section;
}
