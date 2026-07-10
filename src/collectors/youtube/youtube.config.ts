// youtube.config.ts

export interface InnertubeConfig {
  apiKey: string;
  clientVersion: string;
  clientName: string; // usually "WEB" / "1"
  visitorData?: string; // helps avoid some bot checks
}

/**
 * Pull InnerTube config out of the page HTML.
 * YouTube exposes it via ytcfg.set({...}) and inside INNERTUBE_CONTEXT.
 */
export function extractInnertubeConfig(html: string): InnertubeConfig {
  const grab = (re: RegExp): string | undefined => html.match(re)?.[1];

  const apiKey =
    grab(/"INNERTUBE_API_KEY":\s*"([^"]+)"/) ??
    grab(/"innertubeApiKey":\s*"([^"]+)"/);

  const clientVersion =
    grab(/"INNERTUBE_CONTEXT_CLIENT_VERSION":\s*"([^"]+)"/) ??
    grab(/"clientVersion":\s*"([^"]+)"/) ??
    grab(/"INNERTUBE_CLIENT_VERSION":\s*"([^"]+)"/);

  const clientName =
    grab(/"INNERTUBE_CONTEXT_CLIENT_NAME":\s*"?([^",]+)"?/) ?? "WEB";

  const visitorData = grab(/"visitorData":\s*"([^"]+)"/);

  if (!apiKey || !clientVersion) {
    throw new Error("Failed to extract InnerTube config from page HTML");
  }

  return { apiKey, clientVersion, clientName, visitorData };
}
