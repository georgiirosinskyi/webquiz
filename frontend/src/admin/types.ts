import type { ConfigData } from "../files/types";

// window.__WEBQUIZ__.page of /admin/ (see serve_admin_page in server.py)
export interface AdminPageData {
  isTrustedIp: boolean;
  networkUrls: string[];
  downloadableQuizzes: DownloadableQuiz[];
  tunnelPublicKey: string;
  configPath: string | null;
  configContent: string | null;
  configData: ConfigData | null;
}

export interface DownloadableQuiz {
  name: string;
  download_path: string;
  folder: string;
}

export interface QuizInfo {
  filename: string;
  title: string | null;
  // Settings from the file (see _quiz_list_entry in server.py), missing when it cannot be read
  total_questions?: number;
  total_points?: number | null;
  time_limit?: number;
  randomize_questions?: boolean;
  allow_skip_questions?: boolean;
  show_right_answer?: boolean;
  show_answers_on_completion?: boolean;
  show_final_list?: boolean;
}

export interface QuizList {
  quizzes: QuizInfo[];
  // Every folder of quizzes/ ("grade5/", "grade5/algebra/"), empty ones too
  folders?: string[];
  current_quiz: string | null;
  force_all_completed?: boolean;
  show_answers_on_completion?: boolean;
}

export interface TunnelStatus {
  configured?: boolean;
  server?: string;
  socket_name?: string | null;
  keys_status?: string;
  connected?: boolean;
  url?: string | null;
  error?: string | null;
}

export type UserStatus = "pending" | "in_progress" | "completed" | "time_up";

export type CellState = "think" | "ok" | "fail" | "skip";

// One user on the overview page (see _admin_user_record in server.py)
export interface AdminUser {
  user_id: string;
  username: string;
  registration_fields: Record<string, string>;
  status: UserStatus;
  registered_at?: string;
  answered: number;
  correct: number;
  skipped: number;
  earned_points: number;
  mark: string | number | null;
  points_percentage: number | null;
  elapsed_seconds: number | null;
  remaining_seconds: number | null;
  question_order: number[];
  live_stats: Record<string, { state: CellState; time_taken: number | null }>;
  // Given answers by question id: the typed text or the chosen option texts
  answers?: Record<string, string[]>;
  // Client side: when the record arrived, so the timers can run on between updates
  received_at?: number;
}

export interface QuizQuestionInfo {
  id: number;
  question: string;
  image?: string | null;
  points: number;
  correct_answer: string[];
}

// The running quiz (see _admin_quiz_info in server.py)
export interface CurrentQuiz {
  filename: string | null;
  title: string | null;
  total_questions: number;
  total_points: number;
  time_limit: number;
  randomize_questions: boolean;
  allow_skip_questions: boolean;
  show_answers_on_completion: boolean;
  force_all_completed: boolean;
  requires_approval: boolean;
  questions: QuizQuestionInfo[];
}

export interface PendingUser {
  username: string;
  registration_fields: Record<string, string>;
}

export type TransferAction = "save" | "replace" | "rename" | "skip";

export interface IncomingFile {
  type: string;
  name: string;
  size: number;
  case: "new" | "same" | "different" | "in_use";
  target: string;
  actions: TransferAction[];
  default_action: TransferAction;
  suggested_name: string;
}

export interface TransferRequest {
  id: string;
  from: string;
  files: IncomingFile[];
}

// Messages of /ws/admin (see websocket_admin and broadcast_to_admin_websockets in server.py)
export type AdminMessage =
  | {
      type: "initial_state";
      requires_approval?: boolean;
      pending_users?: Record<string, PendingUser>;
      tunnel?: TunnelStatus;
      transfer_requests?: TransferRequest[];
      quiz?: CurrentQuiz;
      users?: AdminUser[];
    }
  | {
      type: "quiz_switched";
      requires_approval?: boolean;
      pending_users?: Record<string, PendingUser>;
      quiz?: CurrentQuiz;
      users?: AdminUser[];
    }
  | { type: "user_updated"; user: AdminUser }
  | { type: "transfer_request"; request: TransferRequest }
  | { type: "transfer_request_removed"; id: string }
  | { type: "transfer_result"; offer: { to: string; status: string } }
  | { type: "tunnel_status"; tunnel?: TunnelStatus }
  | { type: "new_registration"; user_id: string; username: string; registration_fields?: Record<string, string> }
  | { type: "registration_updated"; user_id: string; username: string; registration_fields?: Record<string, string> }
  | { type: "user_approved"; user_id: string }
  | { type: "answers_forced"; forced: boolean; message?: string };

// "моя_школа" -> "Моя Школа"
export function fieldNameToLabel(fieldName: string): string {
  return fieldName
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// True when `latest` is a higher dotted version than `current`.
export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (version: string) => version.split(".").map((part) => parseInt(part, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

// Tunnel status updates may omit the server name; keep the last known one.
export function mergeTunnel(previous: TunnelStatus | null, update: TunnelStatus | undefined): TunnelStatus | null {
  if (!update) return previous;
  return { ...update, server: update.server || previous?.server };
}
