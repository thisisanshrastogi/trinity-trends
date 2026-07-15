# Platform Support

This table tracks which data platforms are implemented in Trinity Trends.

## Implemented

| Platform | Trend Quality | Engagement Signals | Collection Method | Status |
|----------|--------------|-------------------|-------------------|--------|
| **Reddit** | Excellent (niche communities) | Upvotes, comments | HTML scraping (`old.reddit.com`) | Done |
| **YouTube** | Excellent (broad reach) | Views, likes, comments | InnerTube API | Done |
| **Hacker News** | Excellent (tech) | Points, comments | Algolia Search API | Done |
| **Google Trends** | Excellent (search demand) | Interest over time, related queries | `google-trends-api` wrapper | Done (collector only, disabled in orchestrator) |

## Planned / Not Yet Implemented

| Platform | Trend Quality | Engagement Signals | Difficulty | Notes |
|----------|--------------|-------------------|------------|-------|
| TikTok | Excellent | Likes, comments, shares, saves, views | Very Hard | Requires authentication, anti-bot measures |
| X (Twitter) | Excellent | Likes, reposts, replies | Hard | API access requires paid tier |
| Instagram | Good | Likes, comments | Hard | Requires authentication |
| Product Hunt | Excellent (products) | Upvotes, discussions | Easy | Good candidate for next implementation |
| Pinterest | Good | Saves | Medium | Niche use case |
| Medium | Good | Claps, responses | Medium | |
| Dev.to | Good | Reactions | Easy | Similar to HN, good for tech niches |
| Quora | Good | Upvotes, answers | Medium | |

## Engagement Weight Rationale

Different platforms have vastly different scales for engagement metrics. To enable cross-platform comparison, raw engagement is multiplied by a platform weight:

```python
PLATFORM_WEIGHTS = {
    "reddit": 1.0,       # 500 upvotes = high engagement
    "youtube": 0.001,    # 500,000 views = high engagement  
    "hackerNews": 1.0    # 500 points = front-page level
}
```

Reddit and Hacker News engagement is calculated as `score + (comments * 2)`, weighting comments higher because they indicate deeper audience investment.
