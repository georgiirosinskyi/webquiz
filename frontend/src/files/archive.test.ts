import { describe, expect, it } from "vitest";
import { archiveFileUrl, archiveZipUrl, fileLabelKey, runStart, viewMode, visibleRuns, type ArchiveRun } from "./archive";

const run = (name: string, users: number, current = false): ArchiveRun => ({ name, users, current, files: [] });

describe("visibleRuns", () => {
  const runs = [run("a", 0, true), run("b", 0), run("c", 3)];

  it("hides runs without users except the current one", () => {
    expect(visibleRuns(runs, false).map((r) => r.name)).toEqual(["a", "c"]);
  });

  it("shows everything when asked", () => {
    expect(visibleRuns(runs, true)).toHaveLength(3);
  });
});

describe("runStart", () => {
  it("prefers the start time from the summary", () => {
    expect(runStart({ ...run("2026-01-01-000000-x", 1), started_at: "2026-10-15T14:30:05" })).toEqual(
      new Date(2026, 9, 15, 14, 30, 5),
    );
  });

  it("reads the date from the folder name", () => {
    expect(runStart(run("2026-10-15-143005-grade5_math", 1))).toEqual(new Date(2026, 9, 15, 14, 30, 5));
    expect(runStart(run("other", 1))).toBeNull();
  });
});

describe("files", () => {
  it("opens CSV as a table and the log as text", () => {
    expect(viewMode("users.CSV")).toBe("table");
    expect(viewMode("server.log")).toBe("text");
  });

  it("encodes the run and file names", () => {
    expect(archiveFileUrl("2026-10-15-143005-5 клас", "users.csv", "file")).toBe(
      "/api/admin/archive/2026-10-15-143005-5%20%D0%BA%D0%BB%D0%B0%D1%81/users.csv?download=1",
    );
    expect(archiveFileUrl("r", "users.csv", "xlsx")).toBe("/api/admin/archive/r/users.csv?download=1&format=xlsx");
    expect(archiveFileUrl("r", "server.log")).toBe("/api/admin/archive/r/server.log");
  });

  it("builds the zip URL of a run", () => {
    expect(archiveZipUrl("2026-10-15-143005-5 клас")).toBe("/api/admin/archive-zip/2026-10-15-143005-5%20%D0%BA%D0%BB%D0%B0%D1%81");
  });

  it("gives the known files readable names", () => {
    expect(fileLabelKey("users.csv")).toBe("archive.file_users");
    expect(fileLabelKey("server.log")).toBe("archive.file_log");
    expect(fileLabelKey("notes.txt")).toBeNull();
  });
});
