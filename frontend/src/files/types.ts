import { DEFAULT_BACKGROUND_COLOR } from "../shared/background";
import type { MessageKey } from "../shared/i18n";

// What can be sent to another server: quiz files and archive runs (sent as "<run>.zip")
export type FileType = "quizzes" | "archive";

export interface ConfigData {
  language: string;
  extra_answers_with_users_csv: boolean;
  question_navigation?: boolean;
  registration: {
    approve?: boolean;
    username_label?: string;
    fields?: string[];
    disabled_fields?: string[];
    field_options?: Record<string, string[]>;
  };
  appearance?: {
    background_color?: string;
    background_image?: string;
  };
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

// Selection keys are "type/name"; quiz names may contain "/" (subfolders),
// so only the first slash separates the type.
export function transferKey(type: FileType, name: string): string {
  return `${type}/${name}`;
}

export function parseTransferKey(key: string): { type: FileType; name: string } {
  const slash = key.indexOf("/");
  return { type: key.slice(0, slash) as FileType, name: key.slice(slash + 1) };
}

export const TRANSFER_STATUS_TEXT: Record<OutgoingOffer["status"], MessageKey> = {
  waiting: "send.status_waiting",
  accepted: "send.status_accepted",
  rejected: "send.status_rejected",
  failed: "send.status_failed",
  expired: "send.status_expired",
};

// Config form values <-> {data: {...}} body of PUT /api/admin/config.
// Enabled and disabled registration fields are one list with a checkbox per row.
export interface ConfigFormValues {
  language: string;
  extra_answers_with_users_csv: boolean;
  question_navigation: boolean;
  approve: boolean;
  username_label: string;
  // options: the values to choose from on the registration form (empty: free text)
  fields: { name: string; enabled: boolean; options: string[] }[];
  // Quiz page background: a color, or an image (shown over the color)
  background_mode: "color" | "image";
  background_color: string;
  background_image: string;
}

export function configToForm(config: ConfigData | null): ConfigFormValues {
  const registration = config?.registration || {};
  const appearance = config?.appearance || {};
  return {
    language: config?.language === "en" ? "en" : "uk",
    extra_answers_with_users_csv: !!config?.extra_answers_with_users_csv,
    question_navigation: !!config?.question_navigation,
    approve: !!registration.approve,
    username_label: registration.username_label || "",
    fields: [
      ...(registration.fields || []).map((name) => ({ name, enabled: true })),
      ...(registration.disabled_fields || []).map((name) => ({ name, enabled: false })),
    ].map((field) => ({ ...field, options: [...(registration.field_options?.[field.name] || [])] })),
    background_mode: appearance.background_image ? "image" : "color",
    background_color: appearance.background_color || DEFAULT_BACKGROUND_COLOR,
    background_image: appearance.background_image || "",
  };
}

// The form after importing a settings file: the sections found in the file replace the form's, the rest stays
export function mergeImportedConfig(values: ConfigFormValues, imported: Partial<ConfigData>): ConfigFormValues {
  return configToForm({ ...formToConfig(values), ...imported } as ConfigData);
}

export function formToConfig(values: ConfigFormValues) {
  const fields = (values.fields || [])
    .map((field) => ({
      ...field,
      name: (field.name || "").trim(),
      options: (field.options || []).map((option) => option.trim()).filter(Boolean),
    }))
    .filter((field) => field.name);
  return {
    language: values.language,
    extra_answers_with_users_csv: values.extra_answers_with_users_csv,
    question_navigation: values.question_navigation,
    registration: {
      approve: values.approve,
      username_label: values.username_label || "",
      fields: fields.filter((field) => field.enabled).map((field) => field.name),
      disabled_fields: fields.filter((field) => !field.enabled).map((field) => field.name),
      // Always sent, so values removed in the form are removed from the file too
      field_options: Object.fromEntries(
        fields.filter((field) => field.options.length > 0).map((field) => [field.name, field.options]),
      ),
    },
    appearance: {
      background_color: values.background_color || DEFAULT_BACKGROUND_COLOR,
      // Color mode clears the image; the color stays under an image while it loads
      background_image: values.background_mode === "image" ? (values.background_image || "").trim() : "",
    },
  };
}
