import { getLanguage } from "./i18n";

export function formatFileSize(bytes: number): string {
  if (!bytes) return "0 B";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${parseFloat((bytes / 1024 ** i).toFixed(2))} ${sizes[i]}`;
}

export function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleString(getLanguage() === "en" ? "en-GB" : "uk-UA");
}

// RFC 4180 style: quoted fields may contain commas, quotes ("") and newlines.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.length > 1 || row[0] !== "") rows.push(row);
  return rows;
}

// Pixel width of each CSV column from its longest line (header included), so a table with a fixed
// header keeps the header and the body aligned.
export function csvColumnWidths(rows: string[][], min = 70, max = 320): number[] {
  const count = Math.max(0, ...rows.map((row) => row.length));
  return Array.from({ length: count }, (_, i) => {
    const longest = Math.max(0, ...rows.map((row) => Math.max(0, ...(row[i] || "").split("\n").map((line) => line.length))));
    return Math.min(max, Math.max(min, longest * 8 + 24));
  });
}
