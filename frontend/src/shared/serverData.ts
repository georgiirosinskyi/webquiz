// Data the server injects into every page as window.__WEBQUIZ__
// (see render_ui_page in server.py): common fields plus `page`, the data of
// that page. The Vite dev server has no injection, so every field needs a default.
export interface ServerData {
  language: "uk" | "en";
  version: string;
}

declare global {
  interface Window {
    __WEBQUIZ__?: Partial<ServerData> & { page?: unknown };
  }
}

export function getServerData(): ServerData {
  const data = window.__WEBQUIZ__ || {};
  return {
    language: data.language === "en" ? "en" : "uk",
    version: data.version || "dev",
  };
}

export function getPageData<T extends object>(defaults: T): T {
  return { ...defaults, ...((window.__WEBQUIZ__?.page as Partial<T>) || {}) };
}
