import { describe, expect, it } from "vitest";
import { csvColumnWidths, formatFileSize, parseCsv } from "./format";

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

describe("csvColumnWidths", () => {
  it("sizes each column by its longest line within the limits", () => {
    expect(csvColumnWidths([["№", "Ім'я"], ["1", "Олександра Костянтинівна"], ["2", "x\ny"]])).toEqual([70, 24 * 8 + 24]);
    expect(csvColumnWidths([["a".repeat(100)]])).toEqual([320]);
  });

  it("covers rows longer than the header", () => {
    expect(csvColumnWidths([["a"], ["b", "cc"]])).toHaveLength(2);
  });
});
