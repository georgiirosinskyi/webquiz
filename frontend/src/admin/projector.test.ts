import { describe, expect, it } from "vitest";
import { addressFontSize, displayUrl } from "./projector";

describe("projector page", () => {
  it("shows the address the way people type it", () => {
    expect(displayUrl("http://192.168.1.5:8080/")).toBe("192.168.1.5:8080");
    expect(displayUrl("https://t.example.com/ab12/")).toBe("t.example.com/ab12/");
    expect(displayUrl("http://192.168.1.5/webquiz/")).toBe("192.168.1.5/webquiz/");
  });

  it("makes the address as large as the window allows", () => {
    expect(addressFontSize(1920)).toBe(144);
    expect(addressFontSize(1280)).toBe(96);
    expect(addressFontSize(300)).toBe(28);
  });
});
