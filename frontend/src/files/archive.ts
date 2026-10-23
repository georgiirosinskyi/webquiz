import type { MessageKey } from "../shared/i18n";

// One quiz run of the archive (see GET /api/admin/archive and webquiz/archive.py)
export interface ArchiveRun {
  name: string;
  quiz?: string | null;
  title?: string | null;
  started_at?: string | null;
  total_questions?: number;
  users?: number;
  answers?: number;
  correct_percent?: number | null;
  avg_time_per_question?: number | null;
  current: boolean;
  files: { name: string; size: number }[];
}

// Runs without users (a restart nobody used) are hidden unless asked for; the current run always shows.
export function visibleRuns(runs: ArchiveRun[], showEmpty: boolean): ArchiveRun[] {
  return showEmpty ? runs : runs.filter((run) => run.current || (run.users ?? 0) > 0);
}

// "2026-10-15-143005-math" -> 2026-10-15T14:30:05 (when summary.json has no start time)
export function runStart(run: ArchiveRun): Date | null {
  if (run.started_at) return new Date(run.started_at);
  const match = run.name.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})/);
  if (!match) return null;
  const [, year, month, day, hours, minutes, seconds] = match.map(Number);
  return new Date(year, month - 1, day, hours, minutes, seconds);
}

// CSV files open as a table, the rest (the log) as text
export const viewMode = (filename: string): "table" | "text" => (filename.toLowerCase().endsWith(".csv") ? "table" : "text");

// download: the file as it is, or a CSV file converted to an Excel workbook
export const archiveFileUrl = (run: string, filename: string, download?: "file" | "xlsx") =>
  `/api/admin/archive/${encodeURIComponent(run)}/${encodeURIComponent(filename)}` +
  (download === "xlsx" ? "?download=1&format=xlsx" : download ? "?download=1" : "");

// Readable names of the files a run has; other files are shown by their file name
const FILE_LABELS: Record<string, MessageKey> = {
  "answers.csv": "archive.file_answers",
  "users.csv": "archive.file_users",
  "answers_with_users.csv": "archive.file_answers_with_users",
  "server.log": "archive.file_log",
};

export const fileLabelKey = (filename: string): MessageKey | null => FILE_LABELS[filename] || null;
