import { describe, expect, it } from "vitest";
import { viewerWidth } from "./FileViewerModal";

describe("viewerWidth", () => {
  it("fits a narrow table", () => {
    expect(viewerWidth(500, 2000)).toBe(568);
  });

  it("stops at 90% of the window", () => {
    expect(viewerWidth(3000, 1000)).toBe(900);
  });

  it("keeps a minimum width and uses 1000px for text", () => {
    expect(viewerWidth(100, 2000)).toBe(360);
    expect(viewerWidth(null, 2000)).toBe(1000);
    expect(viewerWidth(null, 800)).toBe(720);
  });
});
