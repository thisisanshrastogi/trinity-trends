// youtube.types.ts

import type { FilterSelection } from "./youtube.filters.js";

export interface YouTubeSearchRequest {
  query: string;
  region?: string;
  continuation?: string;
  maxResults?: number;
  filters?: FilterSelection[];
}

export interface YouTubeSearchPage {
  videos: YouTubeVideo[];
  continuation?: string;
  hasMore: boolean;
}

// youtube.types.ts

export interface YouTubeVideo {
  id: string;
  title: string;
  description?: string;
  channelId: string;
  channelName: string;
  publishedText: string;
  duration?: string;
  viewsText: string;
  thumbnail: string;
  badges: string[];
  verified: boolean;
  rank?: number;

  // derived links
  url: string; // watch page
  shortUrl: string; // youtu.be short link
  embedUrl: string; // iframe embed
  channelUrl: string; // channel page
}
