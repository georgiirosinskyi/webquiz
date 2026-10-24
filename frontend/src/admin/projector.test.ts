import { describe, expect, it } from "vitest";
import { addressFontSize, displayUrl, projectorUrls } from "./projector";

describe("projector page", () => {
  it("puts the public tunnel address first while the tunnel is connected", () => {
    const urls = ["http://192.168.1.5:8080/", "http://10.0.0.2:8080/"];
    expect(projectorUrls(urls, null)).toEqual([
      { url: "http://192.168.1.5:8080/", public: false },
      { url: "http://10.0.0.2:8080/", public: false },
    ]);
    expect(projectorUrls(urls, "https://t.example.com/ab12/")).toEqual([
      { url: "https://t.example.com/ab12/", public: true },
      { url: "http://192.168.1.5:8080/", public: false },
      { url: "http://10.0.0.2:8080/", public: false },
    ]);
  });

  it("shows the address the way people type it", () => {
    expect(displayUrl("http://192.168.1.5:8080/")).toBe("192.168.1.5:8080");
    expect(displayUrl("https://t.example.com/ab12/")).toBe("t.example.com/ab12/");
    expect(displayUrl("http://192.168.1.5/webquiz/")).toBe("192.168.1.5/webquiz/");
  });

  it("makes the addresses large, smaller when there are more of them", () => {
    expect(addressFontSize(1, 1920)).toBe(144);
    expect(addressFontSize(2, 1920)).toBe(96);
    expect(addressFontSize(4, 1920)).toBe(69);
    expect(addressFontSize(4, 400)).toBe(28);
  });
});
