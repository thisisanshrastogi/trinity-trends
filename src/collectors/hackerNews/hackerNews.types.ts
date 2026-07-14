export type HackerNewsTag =
  | "story"
  | "comment"
  | "ask_hn"
  | "show_hn"
  | "poll"
  | "pollopt"
  | "front_page";

export interface HackerNewsSearchRequest {
  query?: string;

  page?: number;
  limit?: number;

  sort?: "relevance" | "date";

  tags?: HackerNewsTag[];

  author?: string;

  minPoints?: number;
  maxPoints?: number;

  minComments?: number;
  maxComments?: number;

  after?: Date;
  before?: Date;

  exactMatch?: boolean;

  attributesToSearch?: ("title" | "story_text" | "comment_text")[];
}

export interface HackerNewsPost {
  id: string;

  type: "story" | "comment" | string;

  title?: string;

  text?: string;

  url?: string;

  author: string;

  createdAt: Date;

  points: number;

  comments: number;

  tags: string[];

  storyId?: string;

  parentId?: string;
  
  rank?: number;
}

export interface HackerNewsSearchPage {
  posts: HackerNewsPost[];
  
  page: number;
  totalPages: number;
  hitsPerPage: number;

  hasNext: boolean;
}
