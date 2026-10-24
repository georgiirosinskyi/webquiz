// The address as people type it: browsers add the scheme, a bare "/" path is left out
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^([^/]+)\/$/, "$1");
}

// Font size (px) of the address: as large as fits the window width
export function addressFontSize(width: number): number {
  return Math.max(28, Math.round(width * 0.075));
}
