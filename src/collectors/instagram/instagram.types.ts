export interface InstagramSearchRequest {
  query: string;
  limit?: number;
  searchType?: "keyword" | "hashtag";
}

export interface InstagramCollectRequest extends InstagramSearchRequest {
  limit?: number;
}

export interface InstagramPost {
  pk: string;
  code: string;
  media_type: number;
  username: string;
  full_name: string;
  is_verified: boolean;
  width: number;
  height: number;
  caption: string;
  like_count: number;
  comment_count: number;
  view_count: number;
  taken_at: number;
  engagement_velocity: number;
  url: string;
  rank?: number;
  transcript?: string;
}

export interface InstagramSearchPage {
  posts: InstagramPost[];
  // If we ever reverse-engineer Instagram pagination, we can add continuation token here
  continuation?: string;
}

/**
 * The JSON output shape produced by the Python ig_scraper (main.py).
 * Example:
 * {
 *   "metadata": { "scraped_at": "...", "total_hashtags": 1, ... },
 *   "results": { "credit cards": ["https://instagram.com/p/ABC123/", ...] }
 * }
 */
export interface InstagramScraperOutput {
  metadata: {
    scraped_at: string;
    total_hashtags: number;
    total_posts: number;
    unique_posts: number;
    posts_per_hashtag_target: number | null;
    failed_hashtags: string[];
  };
  results: Record<string, string[]>;
}
