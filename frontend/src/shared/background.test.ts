import { describe, expect, it } from "vitest";
import { DEFAULT_BACKGROUND_COLOR, backgroundStyle, isDarkColor, isHexColor } from "./background";

describe("isHexColor", () => {
  it("accepts short and long hex colors only", () => {
    expect(isHexColor("#fff")).toBe(true);
    expect(isHexColor("#1F2937")).toBe(true);
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor("#12345")).toBe(false);
  });
});

describe("isDarkColor", () => {
  it("tells dark colors from light ones", () => {
    expect(isDarkColor("#1f2937")).toBe(true);
    expect(isDarkColor("#000")).toBe(true);
    expect(isDarkColor("#ffffff")).toBe(false);
    expect(isDarkColor("#f5f5f5")).toBe(false);
  });
});

describe("backgroundStyle", () => {
  it("uses the dark default without a config", () => {
    expect(backgroundStyle(undefined)).toEqual({ backgroundColor: DEFAULT_BACKGROUND_COLOR, backgroundImage: "", dark: true });
  });

  it("keeps a light color light", () => {
    expect(backgroundStyle({ color: "#f5f5f5", image: "" })).toMatchObject({ backgroundColor: "#f5f5f5", dark: false });
  });

  it("makes image paths relative and ignores an invalid color", () => {
    expect(backgroundStyle({ color: "blue", image: "/imgs/bg 1.jpg" })).toEqual({
      backgroundColor: DEFAULT_BACKGROUND_COLOR,
      backgroundImage: 'url("imgs/bg 1.jpg")',
      dark: true,
    });
  });

  it("keeps full URLs", () => {
    expect(backgroundStyle({ color: "#fff", image: "https://example.com/a.png" }).backgroundImage).toBe(
      'url("https://example.com/a.png")',
    );
  });
});
