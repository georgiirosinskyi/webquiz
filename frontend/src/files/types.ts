export type FileType = "csv" | "logs" | "quizzes";

export interface FileInfo {
  name: string;
  size: number;
  modified: string;
}

export type FileLists = Record<FileType, FileInfo[]>;

export interface ConfigData {
  language: string;
  extra_answers_with_users_csv: boolean;
  registration: {
    approve?: boolean;
    username_label?: string;
    fields?: string[];
    disabled_fields?: string[];
  };
}

// window.__WEBQUIZ__.page of /files/ (see serve_files_page in server.py)
export interface FilesPageData {
  isTrustedIp: boolean;
  configPath: string | null;
  configContent: string | null;
  configData: ConfigData | null;
}

export interface OutgoingOffer {
  id: string;
  to: string;
  status: "waiting" | "accepted" | "rejected" | "failed" | "expired";
  files: { type: string; name: string }[];
}

export interface TransferState {
  available: boolean;
  name: string | null;
  outgoing: OutgoingOffer[];
}

// Must match FILE_TYPES in webquiz/transfer.py
const TRANSFER_EXTENSIONS: Record<FileType, string[]> = {
  quizzes: [".yaml", ".yml"],
  logs: [".log"],
  csv: [".csv"],
};

export function canTransfer(type: FileType, name: string): boolean {
  const lower = name.toLowerCase();
  return !name.startsWith(".") && TRANSFER_EXTENSIONS[type].some((ext) => lower.endsWith(ext));
}

// Selection keys are "type/name"; names never contain "/" for csv and logs,
// quizzes may (subfolders), so only the first slash separates the type.
export function transferKey(type: FileType, name: string): string {
  return `${type}/${name}`;
}

export function parseTransferKey(key: string): { type: FileType; name: string } {
  const slash = key.indexOf("/");
  return { type: key.slice(0, slash) as FileType, name: key.slice(slash + 1) };
}

export const TRANSFER_STATUS_TEXT: Record<OutgoingOffer["status"], string> = {
  waiting: "⏳ waiting for an answer",
  accepted: "✅ accepted",
  rejected: "❌ rejected",
  failed: "⚠️ the other server could not download the files",
  expired: "⌛ expired (no answer in 30 minutes)",
};

// Config form values <-> {data: {...}} body of PUT /api/admin/config.
// Enabled and disabled registration fields are one list with a checkbox per row.
export interface ConfigFormValues {
  language: string;
  extra_answers_with_users_csv: boolean;
  approve: boolean;
  username_label: string;
  fields: { name: string; enabled: boolean }[];
}

export function configToForm(config: ConfigData | null): ConfigFormValues {
  const registration = config?.registration || {};
  return {
    language: config?.language === "en" ? "en" : "uk",
    extra_answers_with_users_csv: !!config?.extra_answers_with_users_csv,
    approve: !!registration.approve,
    username_label: registration.username_label || "",
    fields: [
      ...(registration.fields || []).map((name) => ({ name, enabled: true })),
      ...(registration.disabled_fields || []).map((name) => ({ name, enabled: false })),
    ],
  };
}

export function formToConfig(values: ConfigFormValues) {
  const fields = (values.fields || [])
    .map((field) => ({ ...field, name: (field.name || "").trim() }))
    .filter((field) => field.name);
  return {
    language: values.language,
    extra_answers_with_users_csv: values.extra_answers_with_users_csv,
    registration: {
      approve: values.approve,
      username_label: values.username_label || "",
      fields: fields.filter((field) => field.enabled).map((field) => field.name),
      disabled_fields: fields.filter((field) => !field.enabled).map((field) => field.name),
    },
  };
}
