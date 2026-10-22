// window.__WEBQUIZ__.page of /admin/ (see serve_admin_page in server.py)
export interface AdminPageData {
  isTrustedIp: boolean;
  networkUrls: string[];
  downloadableQuizzes: DownloadableQuiz[];
  tunnelPublicKey: string;
}

export interface DownloadableQuiz {
  name: string;
  download_path: string;
  folder: string;
}

export interface QuizInfo {
  filename: string;
  title: string | null;
}

export interface QuizList {
  quizzes: QuizInfo[];
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
    }
  | { type: "quiz_switched"; requires_approval?: boolean; pending_users?: Record<string, PendingUser> }
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
