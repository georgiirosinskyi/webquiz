import { describe, expect, it } from "vitest";
import { STATE_STYLES, formatTime } from "./questionState";

describe("questionState", () => {
  it("formats answer times", () => {
    expect(formatTime(null)).toBeNull();
    expect(formatTime(-1)).toBeNull(); // timeout placeholder
    expect(formatTime(12.4)).toBe("12s");
    expect(formatTime(75)).toBe("1m 15s");
  });

  it("gives every state its own colors", () => {
    expect(STATE_STYLES.skip.background).toBe("#fff3cd"); // skipped questions are yellow
    expect(STATE_STYLES.fail.color).toBe("#721c24");
    const backgrounds = Object.values(STATE_STYLES).map((style) => style.background);
    expect(new Set(backgrounds).size).toBe(backgrounds.length);
  });
});
