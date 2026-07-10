export type RedditSort = "relevance" | "hot" | "top" | "new" | "comments";

export type RedditTime = "hour" | "day" | "week" | "month" | "year" | "all";

export interface RedditSearchRequest {
  query: string;
  sort?: RedditSort;
  time?: RedditTime;
  after?: string;
  cursorCount?: number;
}

export interface RedditSearchPage {
  posts: RedditSearchPost[];

  after?: string;
  count?: number;

  hasNext: boolean;
}

export interface RedditSearchPost {
  // ---------- Search ----------

  rank: number;

  // ---------- Identity ----------

  fullname: string; // t3_xxxxx
  postId: string; // xxxxx

  // ---------- Content ----------

  title: string;

  body: string;

  permalink: string;

  mediaUrl?: string;

  // ---------- Author ----------

  author: string;

  authorUrl?: string;

  authorId?: string;

  // ---------- Community ----------

  subreddit: string;

  subredditUrl?: string;

  // ---------- Metrics ----------

  score: number;

  comments: number;

  // ---------- Time ----------

  createdIso?: string;

  createdText?: string;

  // ---------- Flair ----------

  flair?: string;

  flairTitle?: string;

  flairStyle?: string;

  // ---------- Thumbnail ----------

  thumbnail?: string;

  thumbnailWidth?: number;

  thumbnailHeight?: number;

  duration?: string;

  // ---------- Flags ----------

  hasThumbnail: boolean;

  hasFlair: boolean;

  isSelf: boolean;

  // ---------- Debug ----------

  rawHtml?: string;
}
