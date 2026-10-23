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
      question_navigation: true,
      registration: { approve: true, username_label: "Name", fields: ["Grade"], disabled_fields: ["School"] },
      appearance: { background_color: "#ffffff", background_image: "/imgs/bg.jpg" },
    });
    expect(form).toEqual({
      language: "en",
      extra_answers_with_users_csv: true,
      question_navigation: true,
      approve: true,
      username_label: "Name",
      fields: [
        { name: "Grade", enabled: true },
        { name: "School", enabled: false },
      ],
      background_mode: "image",
      background_color: "#ffffff",
      background_image: "/imgs/bg.jpg",
    });
  });

  it("splits the list back and drops empty names", () => {
    const data = formToConfig({
      language: "uk",
      extra_answers_with_users_csv: false,
      question_navigation: true,
      approve: false,
      username_label: "",
      fields: [
        { name: " Grade ", enabled: true },
        { name: "", enabled: true },
        { name: "School", enabled: false },
      ],
      background_mode: "color",
      background_color: "#336699",
      background_image: "/imgs/old.jpg",
    });
    expect(data.question_navigation).toBe(true);
    expect(data.registration).toEqual({
      approve: false,
      username_label: "",
      fields: ["Grade"],
      disabled_fields: ["School"],
    });
  });

  it("defaults a missing config to Ukrainian with no fields and the dark color", () => {
    expect(configToForm(null)).toMatchObject({
      language: "uk",
      question_navigation: false,
      approve: false,
      fields: [],
      background_mode: "color",
      background_color: "#1f2937",
      background_image: "",
    });
  });

  it("clears the image in color mode and keeps it in image mode", () => {
    const base = configToForm(null);
    expect(formToConfig({ ...base, background_color: "#336699", background_image: "/imgs/a.jpg" }).appearance).toEqual({
      background_color: "#336699",
      background_image: "",
    });
    expect(formToConfig({ ...base, background_mode: "image", background_image: " /imgs/a.jpg " }).appearance).toEqual({
      background_color: "#1f2937",
      background_image: "/imgs/a.jpg",
    });
  });
});
