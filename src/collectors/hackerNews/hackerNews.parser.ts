import { HackerNewsPost, HackerNewsSearchPage } from "./hackerNews.types.js";

export class HackerNewsParser {
  parseSearch(data: any): HackerNewsSearchPage {
    const hits = data.hits || [];
    
    const posts: HackerNewsPost[] = hits.map((hit: any) => {
      const tags: string[] = hit._tags || [];
      let type = "story";
      if (tags.includes("comment")) {
        type = "comment";
      } else if (tags.includes("poll")) {
        type = "poll";
      } else if (tags.includes("pollopt")) {
        type = "pollopt";
      } else if (tags.includes("job")) {
        type = "job";
      }

      return {
        id: hit.objectID,
        type: type,
        title: hit.title,
        text: hit.story_text || hit.comment_text,
        url: hit.url,
        author: hit.author,
        createdAt: hit.created_at ? new Date(hit.created_at) : new Date(),
        points: hit.points || 0,
        comments: hit.num_comments || 0,
        tags: tags,
        storyId: hit.story_id ? String(hit.story_id) : undefined,
        parentId: hit.parent_id ? String(hit.parent_id) : undefined,
      };
    });

    const page = data.page || 0;
    const totalPages = data.nbPages || 0;
    const hitsPerPage = data.hitsPerPage || 0;
    
    return {
      posts,
      page,
      totalPages,
      hitsPerPage,
      hasNext: page < totalPages - 1,
    };
  }
}
