import { describe, expect, it } from "vitest";
import { sectionFromPath } from "./router";

describe("sectionFromPath", () => {
  it("maps admin paths to sections", () => {
    expect(sectionFromPath("/admin/")).toBe("overview");
    expect(sectionFromPath("/admin")).toBe("overview");
    expect(sectionFromPath("/admin/quizzes")).toBe("quizzes");
    expect(sectionFromPath("/admin/settings/")).toBe("settings");
    expect(sectionFromPath("/admin/access")).toBe("access");
  });

  it("opens the files section from the old file manager URL", () => {
    expect(sectionFromPath("/files/")).toBe("files");
    expect(sectionFromPath("/admin/files")).toBe("files");
  });

  it("falls back to the overview for unknown sections", () => {
    expect(sectionFromPath("/admin/unknown")).toBe("overview");
  });
});
