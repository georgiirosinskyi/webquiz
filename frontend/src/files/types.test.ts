import { describe, expect, it } from "vitest";
import { configToForm, formToConfig, mergeImportedConfig, parseTransferKey, transferKey } from "./types";

describe("transfer keys", () => {
  it("keeps slashes of quiz subfolders in the name", () => {
    const key = transferKey("quizzes", "grade5/math.yaml");
    expect(parseTransferKey(key)).toEqual({ type: "quizzes", name: "grade5/math.yaml" });
  });

  it("parses archive runs", () => {
    expect(parseTransferKey(transferKey("archive", "2026-10-15-143005-math.zip"))).toEqual({
      type: "archive",
      name: "2026-10-15-143005-math.zip",
    });
  });
});

describe("config form", () => {
  it("shows enabled and disabled fields in one list", () => {
    const form = configToForm({
      language: "en",
      extra_answers_with_users_csv: true,
      question_navigation: true,
      registration: {
        approve: true,
        username_label: "Name",
        fields: ["Grade"],
        disabled_fields: ["School"],
        field_options: { School: ["A", "B"], Other: ["x"] },
      },
      appearance: { background_color: "#ffffff", background_image: "/imgs/bg.jpg" },
    });
    expect(form).toEqual({
      language: "en",
      extra_answers_with_users_csv: true,
      question_navigation: true,
      approve: true,
      username_label: "Name",
      fields: [
        { name: "Grade", enabled: true, options: [] },
        { name: "School", enabled: false, options: ["A", "B"] },
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
        { name: " Grade ", enabled: true, options: [" 9 ", "", "10"] },
        { name: "", enabled: true, options: ["lost"] },
        { name: "School", enabled: false, options: [] },
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
      field_options: { Grade: ["9", "10"] },
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

describe("settings import", () => {
  it("replaces the sections found in the file and keeps the others", () => {
    const current = configToForm({
      language: "en",
      extra_answers_with_users_csv: true,
      registration: { approve: false, fields: ["Grade"] },
      appearance: { background_color: "#111111", background_image: "" },
    });
    const merged = mergeImportedConfig(current, {
      registration: { approve: true, fields: ["Level"], field_options: { Level: ["first", "second"] } },
    });
    expect(merged.language).toBe("en");
    expect(merged.extra_answers_with_users_csv).toBe(true);
    expect(merged.background_color).toBe("#111111");
    expect(merged.approve).toBe(true);
    expect(merged.fields).toEqual([{ name: "Level", enabled: true, options: ["first", "second"] }]);
  });
});
