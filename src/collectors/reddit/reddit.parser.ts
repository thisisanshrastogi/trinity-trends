import * as cheerio from "cheerio";
import type { RedditSearchPage, RedditSearchPost } from "./reddit.types.js";

export const BASE_URL = "https://old.reddit.com";

export const POST_SELECTOR = ".search-result-link";

export const NEXT_SELECTOR = ".nextprev a[rel='nofollow next']";
export const GROUP_SELECTOR = ".search-result-group";
export const GROUP_LABEL_SELECTOR = ".search-header-label";

export function text(el: cheerio.Cheerio<any>): string {
  return el.text().replace(/\s+/g, " ").trim();
}

export function attr(
  el: cheerio.Cheerio<any>,
  name: string,
): string | undefined {
  const value = el.attr(name);

  if (!value) return undefined;

  return value.trim();
}

export function numberFromText(value: string): number {
  const digits = value.replace(/[^\d]/g, "");

  return digits ? Number(digits) : 0;
}

export function style(el: cheerio.Cheerio<any>): string | undefined {
  return attr(el, "style");
}

export function absoluteUrl(url?: string): string | undefined {
  if (!url) return undefined;

  if (url.startsWith("http")) return url;

  return `https://old.reddit.com${url}`;
}

export function parseAuthorId(classes?: string): string | undefined {
  if (!classes) return undefined;

  const match = classes.match(/id-(t2_[A-Za-z0-9]+)/);

  return match?.[1];
}

export class RedditParser {
  parse(html: string): RedditSearchPage {
    const $ = cheerio.load(html);

    const posts: RedditSearchPost[] = [];

    $(POST_SELECTOR).each((index, element) => {
      posts.push(this.parsePost($, $(element), index + 1));
    });

    const pagination = this.parsePagination($);

    return {
      posts,

      after: pagination.after,

      count: pagination.count,

      hasNext: pagination.hasNext,
    };
  }

  private parsePost(
    $: cheerio.CheerioAPI,

    result: cheerio.Cheerio<any>,

    rank: number,
  ): RedditSearchPost {
    //-----------------------------------------
    // Identity
    //-----------------------------------------

    const fullname = attr(result, "data-fullname") ?? "";

    const postId = fullname.replace(/^t3_/, "");

    //-----------------------------------------
    // Title
    //-----------------------------------------

    const titleElement = result.find(".search-title").first();

    const title = text(titleElement);

    const permalink = absoluteUrl(attr(titleElement, "href")) ?? "";

    //-----------------------------------------
    // Author
    //-----------------------------------------

    const authorElement = result.find(".search-author a").first();

    const author = text(authorElement);

    const authorUrl = absoluteUrl(attr(authorElement, "href"));

    const authorId = parseAuthorId(attr(authorElement, "class"));

    //-----------------------------------------
    // Subreddit
    //-----------------------------------------

    const subredditElement = result.find(".search-subreddit-link").first();

    const subreddit = text(subredditElement).replace(/^r\//, "");

    const subredditUrl = absoluteUrl(attr(subredditElement, "href"));

    //-----------------------------------------
    // Metrics
    //-----------------------------------------

    const score = numberFromText(text(result.find(".search-score")));

    const comments = numberFromText(text(result.find(".search-comments")));

    //-----------------------------------------
    // Time
    //-----------------------------------------

    const timeElement = result.find("time").first();

    const createdIso = attr(timeElement, "datetime");

    const createdText = text(timeElement);

    //-----------------------------------------
    // Body
    //-----------------------------------------

    const body = text(result.find(".search-result-body"));

    //-----------------------------------------
    // Flair
    //-----------------------------------------

    const flair = this.parseFlair(result);

    //-----------------------------------------
    // Thumbnail
    //-----------------------------------------

    const thumbnail = this.parseThumbnail(result);

    //-----------------------------------------
    // Footer
    //-----------------------------------------

    const mediaUrl = this.parseFooter(result);

    //-----------------------------------------
    // Raw HTML
    //-----------------------------------------

    const rawHtml = $.html(result);

    return {
      rank,

      fullname,

      postId,

      title,

      body,

      permalink,

      mediaUrl,

      author,

      authorUrl,

      authorId,

      subreddit,

      subredditUrl,

      score,

      comments,

      createdIso,

      createdText,

      flair: flair.label,

      flairTitle: flair.title,

      flairStyle: flair.style,

      thumbnail: thumbnail.url,

      thumbnailWidth: thumbnail.width,

      thumbnailHeight: thumbnail.height,

      duration: thumbnail.duration,

      hasThumbnail: thumbnail.exists,

      hasFlair: flair.exists,

      isSelf: thumbnail.isSelf,

      rawHtml,
    };
  }

  //-----------------------------------------
  // Flair
  //-----------------------------------------

  private parseFlair(result: cheerio.Cheerio<any>) {
    const flair = result.find(".linkflairlabel").first();

    return {
      exists: flair.length > 0,

      label: text(flair),

      title: attr(flair, "title"),

      style: style(flair),
    };
  }

  //-----------------------------------------
  // Thumbnail
  //-----------------------------------------

  private parseThumbnail(result: cheerio.Cheerio<any>) {
    const thumb = result.find(".thumbnail").first();

    const img = thumb.find("img");

    return {
      exists: thumb.length > 0,

      isSelf: thumb.hasClass("self"),

      url: attr(img, "src"),

      width: Number(attr(img, "width")) || undefined,

      height: Number(attr(img, "height")) || undefined,

      duration: text(thumb.find(".duration-overlay")) || undefined,
    };
  }

  //-----------------------------------------
  // Footer
  //-----------------------------------------

  private parseFooter(result: cheerio.Cheerio<any>) {
    void result;

    return undefined;
  }

  //-----------------------------------------
  // Pagination
  //-----------------------------------------

  private parsePagination($: cheerio.CheerioAPI) {
    const postsGroup = $(GROUP_SELECTOR)
      .filter((_, element) => {
        const label = text($(element).find(GROUP_LABEL_SELECTOR).first());

        return label.toLowerCase() === "posts";
      })
      .first();

    const next = postsGroup.find(NEXT_SELECTOR).attr("href");

    if (!next) {
      return {
        after: undefined,

        count: undefined,

        hasNext: false,
      };
    }

    const url = new URL(absoluteUrl(next)!);
    const count = url.searchParams.get("count");

    return {
      after: url.searchParams.get("after") ?? undefined,

      count: count === null ? undefined : Number(count),

      hasNext: Boolean(url.searchParams.get("after")),
    };
  }
}
