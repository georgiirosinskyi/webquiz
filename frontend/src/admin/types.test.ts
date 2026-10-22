import { describe, expect, it } from "vitest";
import { fieldNameToLabel, isNewerVersion, mergeTunnel } from "./types";

describe("admin helpers", () => {
  it("turns field names into labels", () => {
    expect(fieldNameToLabel("моя_школа")).toBe("Моя Школа");
    expect(fieldNameToLabel("grade")).toBe("Grade");
  });

  it("compares dotted versions", () => {
    expect(isNewerVersion("1.22.0", "1.21.9")).toBe(true);
    expect(isNewerVersion("1.21", "1.21.0")).toBe(false);
    expect(isNewerVersion("1.9.0", "1.10.0")).toBe(false);
  });

  it("keeps the tunnel server name across status updates", () => {
    const first = mergeTunnel(null, { configured: true, server: "t.example.com", connected: false });
    const next = mergeTunnel(first, { configured: true, connected: true, url: "https://x" });
    expect(next).toMatchObject({ server: "t.example.com", connected: true, url: "https://x" });
    expect(mergeTunnel(next, undefined)).toBe(next);
  });
});
