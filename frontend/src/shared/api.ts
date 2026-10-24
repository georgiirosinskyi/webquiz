// Thin fetch wrappers for the admin pages. Admin endpoints authenticate with
// the admin_session cookie, so every request sends same-origin credentials.

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T;
}

export interface ApiError {
  error?: string;
  errors?: string[];
}

export async function apiRequest<T = unknown>(url: string, options: RequestInit = {}): Promise<ApiResult<T & ApiError>> {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  let data: unknown = {};
  try {
    data = await response.json();
  } catch {
    // Non-JSON body (e.g. an HTML error page)
  }
  return { ok: response.ok, status: response.status, data: data as T & ApiError };
}

export function apiGet<T = unknown>(url: string) {
  return apiRequest<T>(url);
}

export function apiSend<T = unknown>(method: "POST" | "PUT" | "DELETE", url: string, body?: unknown) {
  return apiRequest<T>(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Text body (file views) or the JSON error the server sends instead.
export async function apiText(url: string): Promise<{ ok: boolean; text: string; error?: string }> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (response.ok) return { ok: true, text: await response.text() };
  let error = `HTTP ${response.status}`;
  try {
    error = (await response.json()).error || error;
  } catch {
    // keep the status text
  }
  return { ok: false, text: "", error };
}

// Downloads through fetch so a JSON error can be shown instead of a broken file.
export async function downloadFile(url: string, filename: string): Promise<string | null> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) {
    try {
      return (await response.json()).error || `HTTP ${response.status}`;
    } catch {
      return `HTTP ${response.status}`;
    }
  }
  saveBlob(await response.blob(), filename);
  return null;
}

// Hand a file made on the page to the browser as a download
export function saveBlob(blob: Blob, filename: string) {
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(blobUrl);
}

// "error: a, b" from {error, errors} responses.
export function errorText(data: ApiError, fallback: string): string {
  const base = data.error || fallback;
  return data.errors && data.errors.length > 0 ? `${base}: ${data.errors.join("; ")}` : base;
}
