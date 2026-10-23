import { afterEach, describe, expect, it } from "vitest";
import { en } from "./i18n/en";
import { uk } from "./i18n/uk";
import { getLanguage, setLanguage, t, tn } from "./i18n";

afterEach(() => setLanguage("uk"));

// Names only: plural texts repeat {n} once per form, and the languages have different form counts
const placeholders = (text: string) => [...new Set([...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))].sort();

describe("admin translations", () => {
  it("defaults to Ukrainian without page data", () => {
    expect(getLanguage()).toBe("uk");
    expect(t("menu.overview")).toBe("Огляд");
  });

  it("switches to English", () => {
    setLanguage("en");
    expect(t("menu.overview")).toBe("Overview");
  });

  it("has every text in both languages, with the same placeholders", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(uk).sort());
    for (const key of Object.keys(uk) as (keyof typeof uk)[]) {
      expect(uk[key].trim(), key).not.toBe("");
      expect(en[key].trim(), key).not.toBe("");
      expect(placeholders(en[key]), key).toEqual(placeholders(uk[key]));
    }
  });

  it("fills placeholders", () => {
    expect(t("overview.switch_title", { name: "a.yaml" })).toBe('Переключитися на "a.yaml"?');
    setLanguage("en");
    expect(t("overview.switch_title", { name: "a.yaml" })).toBe('Switch to "a.yaml"?');
  });

  it("uses the Ukrainian plural forms", () => {
    expect(tn("plural.questions", 1)).toBe("1 питання");
    expect(tn("plural.questions", 3)).toBe("3 питання");
    expect(tn("plural.questions", 5)).toBe("5 питань");
    expect(tn("plural.questions", 21)).toBe("21 питання");
    expect(tn("plural.points", 1.5)).toBe("1.5 бала");
  });

  it("uses the English plural forms", () => {
    setLanguage("en");
    expect(tn("plural.questions", 1)).toBe("1 question");
    expect(tn("plural.questions", 2)).toBe("2 questions");
    expect(tn("plural.files", 1)).toBe("1 file");
  });

  it("has a form for every plural category", () => {
    for (const key of Object.keys(uk).filter((name) => name.startsWith("plural.")) as (keyof typeof uk)[]) {
      expect(uk[key].split("|"), key).toHaveLength(4);
      expect(en[key].split("|"), key).toHaveLength(2);
    }
  });
});
