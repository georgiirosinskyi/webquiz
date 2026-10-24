export interface ProjectorUrl {
  url: string;
  // The public tunnel address (reachable from the internet, not only from the local network)
  public: boolean;
}

// Addresses for the projector page: the public tunnel URL first (while connected), then the local ones
export function projectorUrls(urls: string[], publicUrl: string | null | undefined): ProjectorUrl[] {
  const items: ProjectorUrl[] = [];
  if (publicUrl) items.push({ url: publicUrl, public: true });
  for (const url of urls) {
    if (!items.some((item) => item.url === url)) items.push({ url, public: false });
  }
  return items;
}

// The address as people type it: browsers add the scheme, a bare "/" path is left out
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/^([^/]+)\/$/, "$1");
}

// Font size (px) of the addresses: as large as fits, smaller when there are more of them
export function addressFontSize(count: number, width: number): number {
  const share = count <= 1 ? 0.075 : count === 2 ? 0.05 : 0.036;
  return Math.max(28, Math.round(width * share));
}
