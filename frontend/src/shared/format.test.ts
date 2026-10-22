import { describe, expect, it } from "vitest";
import { formatFileSize, parseCsv, plural } from "./format";

describe("parseCsv", () => {
  it("splits rows and fields", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles quoted commas, quotes and newlines", () => {
    expect(parseCsv('name,answer\n"Doe, J","say ""hi""\nthere"\r\n')).toEqual([
      ["name", "answer"],
      ["Doe, J", 'say "hi"\nthere'],
    ]);
  });

  it("skips blank lines", () => {
    expect(parseCsv("a\n\nb")).toEqual([["a"], ["b"]]);
  });
});

describe("formatFileSize", () => {
  it("uses binary units", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5 MB");
  });
});

describe("plural", () => {
  it("adds s except for one", () => {
    expect(plural(1, "file")).toBe("1 file");
    expect(plural(3, "file")).toBe("3 files");
  });
});
