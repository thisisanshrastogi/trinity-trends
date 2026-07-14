"""
Stage 0 — Normalize raw collected data.

Converts Reddit posts and YouTube videos from collection-scored.json
into a flat, source-agnostic NormalizedItem list.

Steps:
  - Strip HTML/markdown artifacts, decode unicode
  - Remove boilerplate ("Edit: thanks for the awards")
  - Language detection → drop non-English content
  - Filter junk: too short, bot-generated, [deleted]/[removed]
"""

from __future__ import annotations

import re
import html
import logging
from typing import Sequence

from langdetect import detect, DetectorFactory, LangDetectException

from pipeline.models import (
    CollectionScored,
    CollectionResult,
    RedditPost,
    YouTubeVideo,
    HackerNewsPost,
    NormalizedItem,
)
from pipeline import config

# Reproducible language detection
DetectorFactory.seed = 0

logger = logging.getLogger(__name__)

# ── Regex patterns ───────────────────────────────────────────────────────────

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_BOILERPLATE_RE = re.compile(
    r"(?i)(edit\s*:\s*thanks?\s*(for|to)\s*(the\s+)?(awards?|gold|silver|platinum))"
    r"|(\[deleted\]|\[removed\])"
    r"|(https?://\S+)"  # Remove raw URLs
)
_WHITESPACE_RE = re.compile(r"\s+")
_REDDIT_BOT_AUTHORS = frozenset({
    "AutoModerator", "RemindMeBot", "RepostSleuthBot",
    "sneakpeekbot", "WikiSummarizerBot", "HelperBot_",
})
_DELETED_MARKERS = frozenset({"[deleted]", "[removed]"})


def _clean_text(raw: str) -> str:
    """Strip HTML, decode entities, remove boilerplate, collapse whitespace."""
    text = _HTML_TAG_RE.sub(" ", raw)
    text = html.unescape(text)
    text = _BOILERPLATE_RE.sub(" ", text)
    text = _WHITESPACE_RE.sub(" ", text).strip()
    return text


def _is_english(text: str) -> bool:
    """Return True if text is detected as English with sufficient confidence."""
    try:
        return detect(text) == config.TARGET_LANGUAGE
    except LangDetectException:
        return False


def _parse_views(views_text: str) -> int:
    """Parse YouTube view count string like '108,577 views' → 108577."""
    nums = re.sub(r"[^\d]", "", views_text)
    return int(nums) if nums else 0


def _normalize_reddit(post: RedditPost, query: str) -> NormalizedItem | None:
    """Convert a Reddit post to a NormalizedItem, or None if junk."""
    if post.author in _REDDIT_BOT_AUTHORS:
        return None
    if post.title in _DELETED_MARKERS or post.body in _DELETED_MARKERS:
        return None

    combined = f"{post.title}. {post.body}" if post.body else post.title
    text = _clean_text(combined)

    if len(text.split()) < config.MIN_WORD_COUNT:
        return None
    if not _is_english(text):
        return None

    raw_engagement = post.score + post.comments * 2  # comments weighted higher
    engagement = raw_engagement * config.PLATFORM_WEIGHTS.get("reddit", 1.0)

    return NormalizedItem(
        id=f"reddit_{post.postId}",
        source="reddit",
        query=query,
        text=text,
        title=_clean_text(post.title),
        author=post.author,
        score=post.score,
        num_comments=post.comments,
        created_at=post.createdIso,
        url=post.permalink,
        subreddit=post.subreddit,
        engagement=float(engagement),
    )


def _normalize_youtube(video: YouTubeVideo, query: str) -> NormalizedItem | None:
    """Convert a YouTube video to a NormalizedItem, or None if junk."""
    combined = f"{video.title}. {video.description}" if video.description else video.title
    text = _clean_text(combined)

    if len(text.split()) < config.MIN_WORD_COUNT:
        return None
    if not _is_english(text):
        return None

    views = _parse_views(video.viewsText)
    engagement = float(views) * config.PLATFORM_WEIGHTS.get("youtube", 1.0)

    return NormalizedItem(
        id=f"youtube_{video.id}",
        source="youtube",
        query=query,
        text=text,
        title=_clean_text(video.title),
        author=video.channelName,
        score=views,
        created_at=video.publishedText,
        url=video.url,
        channel=video.channelName,
        engagement=engagement,
    )


def _normalize_hackernews(post: HackerNewsPost, query: str) -> NormalizedItem | None:
    """Convert a HackerNews post to a NormalizedItem, or None if junk."""
    if post.title in _DELETED_MARKERS or post.text in _DELETED_MARKERS:
        return None

    combined = f"{post.title}. {post.text}" if post.text else post.title
    text = _clean_text(combined)

    if len(text.split()) < config.MIN_WORD_COUNT:
        return None
    if not _is_english(text):
        return None

    raw_engagement = post.points + post.comments * 2
    engagement = raw_engagement * config.PLATFORM_WEIGHTS.get("hackerNews", 1.0)

    return NormalizedItem(
        id=f"hackernews_{post.id}",
        source="hackerNews",
        query=query,
        text=text,
        title=_clean_text(post.title) if post.title else "",
        author=post.author,
        score=post.points,
        num_comments=post.comments,
        created_at=post.createdAt,
        url=post.url or f"https://news.ycombinator.com/item?id={post.id}",
        engagement=float(engagement),
    )


def normalize(data: CollectionScored) -> list[NormalizedItem]:
    """
    Stage 0 entry point.

    Takes the full collection-scored payload and returns a deduplicated
    list of NormalizedItems from all queries × sources.
    """
    items: list[NormalizedItem] = []
    seen_ids: set[str] = set()

    for result in data.results:
        query = result.query

        # Reddit
        for post in result.reddit:
            item = _normalize_reddit(post, query)
            if item and item.id not in seen_ids:
                seen_ids.add(item.id)
                items.append(item)

        # YouTube
        for video in result.youtube:
            item = _normalize_youtube(video, query)
            if item and item.id not in seen_ids:
                seen_ids.add(item.id)
                items.append(item)

        # Hacker News
        for hn_post in result.hackerNews:
            item = _normalize_hackernews(hn_post, query)
            if item and item.id not in seen_ids:
                seen_ids.add(item.id)
                items.append(item)

    logger.info(f"Stage 0: {len(items)} normalized items from {len(data.results)} queries")
    return items
