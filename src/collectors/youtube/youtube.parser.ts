// youtube.parser.ts

import type { YouTubeSearchPage, YouTubeVideo } from "./youtube.types.js";

export class YouTubeParser {
  parse(html: string): YouTubeSearchPage {
    const data = this.extractInitialData(html);
    return this.collect(data);
  }

  parseContinuation(data: unknown): YouTubeSearchPage {
    return this.collect(data);
  }

  // --- internals ---

  private collect(root: unknown): YouTubeSearchPage {
    const videos: YouTubeVideo[] = [];
    const cont: { token?: string } = {};
    this.walk(root, videos, cont);
    return {
      videos,
      continuation: cont.token,
      hasMore: Boolean(cont.token),
    };
  }

  private extractInitialData(html: string): unknown {
    const patterns = [
      /var ytInitialData\s*=\s*(\{.+?\});<\/script>/s,
      /ytInitialData"\]\s*=\s*(\{.+?\});/s,
      /ytInitialData\s*=\s*(\{.+?\})\s*;\s*<\/script>/s,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m?.[1]) {
        try {
          return JSON.parse(m[1]);
        } catch {
          /* try next pattern */
        }
      }
    }
    throw new Error("Could not locate ytInitialData in the document");
  }

  private walk(
    node: any,
    videos: YouTubeVideo[],
    cont: { token?: string },
  ): void {
    if (!node || typeof node !== "object") return;

    if (node.videoRenderer) {
      const parsed = this.parseVideoRenderer(node.videoRenderer);
      if (parsed) videos.push(parsed);
    }
    if (node.continuationItemRenderer) {
      const token =
        node.continuationItemRenderer.continuationEndpoint?.continuationCommand
          ?.token;
      if (token) cont.token = token;
    }

    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) this.walk(item, videos, cont);
      } else if (child && typeof child === "object") {
        this.walk(child, videos, cont);
      }
    }
  }

  // youtube.parser.ts  — inside the class

  private parseVideoRenderer(v: any): YouTubeVideo | null {
    if (!v?.videoId) return null;

    const id: string = v.videoId;
    const channelId: string =
      v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ??
      "";

    // Prefer YouTube's canonical channel path (handles /@handle and /channel/UC…)
    const canonical: string | undefined =
      v.ownerText?.runs?.[0]?.navigationEndpoint?.browseEndpoint
        ?.canonicalBaseUrl ??
      v.longBylineText?.runs?.[0]?.navigationEndpoint?.browseEndpoint
        ?.canonicalBaseUrl;

    const channelUrl = canonical
      ? `https://www.youtube.com${canonical}`
      : channelId
        ? `https://www.youtube.com/channel/${channelId}`
        : "";

    return {
      id,
      title: this.textOf(v.title),
      description:
        this.textOf(v.detailedMetadataSnippets?.[0]?.snippetText) || undefined,
      channelId,
      channelName: this.textOf(v.ownerText) || this.textOf(v.longBylineText),
      publishedText: this.textOf(v.publishedTimeText),
      duration: this.textOf(v.lengthText) || undefined,
      viewsText: this.textOf(v.viewCountText),
      thumbnail: v.thumbnail?.thumbnails?.at(-1)?.url ?? "",
      badges: (v.badges ?? [])
        .map((b: any) => b?.metadataBadgeRenderer?.label)
        .filter(Boolean),
      verified: (v.ownerBadges ?? []).some((b: any) =>
        (b?.metadataBadgeRenderer?.style ?? "").includes("VERIFIED"),
      ),

      // derived links
      url: `https://www.youtube.com/watch?v=${id}`,
      shortUrl: `https://youtu.be/${id}`,
      embedUrl: `https://www.youtube.com/embed/${id}`,
      channelUrl,
    };
  }

  private textOf(node: any): string {
    if (!node) return "";
    if (typeof node.simpleText === "string") return node.simpleText;
    if (Array.isArray(node.runs))
      return node.runs.map((r: any) => r.text ?? "").join("");
    return "";
  }
}
