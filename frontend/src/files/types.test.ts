import { describe, expect, it } from "vitest";
import { canTransfer, configToForm, formToConfig, parseTransferKey, transferKey } from "./types";

describe("transfer keys", () => {
  it("keeps slashes of quiz subfolders in the name", () => {
    const key = transferKey("quizzes", "grade5/math.yaml");
    expect(parseTransferKey(key)).toEqual({ type: "quizzes", name: "grade5/math.yaml" });
  });

  it("allows only the transferable extensions", () => {
    expect(canTransfer("quizzes", "a.YML")).toBe(true);
    expect(canTransfer("csv", "a.csv")).toBe(true);
    expect(canTransfer("logs", "a.csv")).toBe(false);
    expect(canTransfer("quizzes", ".hidden.yaml")).toBe(false);
  });
});

describe("config form", () => {
  it("shows enabled and disabled fields in one list", () => {
    const form = configToForm({
      language: "en",
      extra_answers_with_users_csv: true,
      registration: { approve: true, username_label: "Name", fields: ["Grade"], disabled_fields: ["School"] },
    });
    expect(form).toEqual({
      language: "en",
      extra_answers_with_users_csv: true,
      approve: true,
      username_label: "Name",
      fields: [
        { name: "Grade", enabled: true },
        { name: "School", enabled: false },
      ],
    });
  });

  it("splits the list back and drops empty names", () => {
    const data = formToConfig({
      language: "uk",
      extra_answers_with_users_csv: false,
      approve: false,
      username_label: "",
      fields: [
        { name: " Grade ", enabled: true },
        { name: "", enabled: true },
        { name: "School", enabled: false },
      ],
    });
    expect(data.registration).toEqual({
      approve: false,
      username_label: "",
      fields: ["Grade"],
      disabled_fields: ["School"],
    });
  });

  it("defaults a missing config to Ukrainian with no fields", () => {
    expect(configToForm(null)).toMatchObject({ language: "uk", approve: false, fields: [] });
  });
});
