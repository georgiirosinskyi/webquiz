// Background of the user quiz page: a color, or an image over that color
// (config section `appearance`, see AppearanceConfig in webquiz/config.py).

export const DEFAULT_BACKGROUND_COLOR = "#1f2937";

export interface Background {
  color: string;
  image: string;
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

// "#abc" -> [170, 187, 204]
function rgb(color: string): [number, number, number] {
  const hex = color.slice(1);
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

// Light text is readable on a dark color; an unknown color counts as dark (the default is dark)
export function isDarkColor(color: string): boolean {
  if (!isHexColor(color)) return true;
  const [r, g, b] = rgb(color);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.6;
}

// Body styles for the page; image paths like "/imgs/a.jpg" become relative (reverse proxy prefix).
export function backgroundStyle(background: Partial<Background> | undefined): {
  backgroundColor: string;
  backgroundImage: string;
  dark: boolean;
} {
  const color = background?.color && isHexColor(background.color) ? background.color : DEFAULT_BACKGROUND_COLOR;
  const image = (background?.image || "").trim();
  const url = image.startsWith("/") ? image.slice(1) : image;
  return {
    backgroundColor: color,
    backgroundImage: url ? `url(${JSON.stringify(url)})` : "",
    // Over an image the footer text gets a shadow anyway; light text reads better on most photos
    dark: url ? true : isDarkColor(color),
  };
}
