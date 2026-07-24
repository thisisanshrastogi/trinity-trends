"""
Stage 0 — Normalize raw collected data.

Converts Reddit posts, YouTube videos, and HackerNews posts from collection-scored.json
into a flat, source-agnostic NormalizedItem list.

Steps:
  - Strip HTML/markdown artifacts, decode unicode
  - Remove boilerplate ("Edit: thanks for the awards")
  - Language detection → drop non-English content
  - Filter junk: too short, bot-generated, [deleted]/[removed]
  - Parse relative dates ("11 months ago") to actual datetimes
  - Calculate log-scaled, time-decayed engagement scores
"""

from __future__ import annotations

import re
import html
import logging
import math
import datetime
from typing import Sequence, Any

from langdetect import detect, DetectorFactory, LangDetectException

from pipeline.models import (
    CollectionScored,
    CollectionResult,
    RedditPost,
    YouTubeVideo,
    HackerNewsPost,
    InstagramPost,
    NormalizedItem,
)
from pipeline import config

# Reproducible language detection
DetectorFactory.seed = 0

logger = logging.getLogger(__name__)

# ── Configuration Constants ──────────────────────────────────────────────────

DECAY_LAMBDA = 0.05  # Controls temporal decay sharpness (~14 day half-life)

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
_DELETED_MARKERS = frozenset({"[deleted]", "[removed]", ""})
# ── Add near the top, with other regex patterns ─────────────────────────────

_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"  # symbols & pictographs, supplemental symbols, etc.
    "\U00002600-\U000027BF"  # misc symbols, dingbats
    "\U0001F1E6-\U0001F1FF"  # regional indicators (flags)
    "\U00002190-\U000021FF"  # arrows (often used decoratively)
    "\U0000FE0F"              # variation selector (emoji presentation)
    "]+",
    flags=re.UNICODE,
)
_HASHTAG_RE = re.compile(r"#(\w+)")
_MULTI_PUNCT_RE = re.compile(r"([!?.]){2,}")



# ── Helper Functions ─────────────────────────────────────────────────────────


def _strip_emojis(text: str) -> str:
    """Remove emoji/pictograph characters, replacing with a space to avoid word-joining."""
    return _EMOJI_RE.sub(" ", text)


def _normalize_hashtags(text: str) -> str:
    """
    Convert #AICodingTools -> 'AI Coding Tools' style spacing so hashtags
    read as natural phrases instead of one fused token for the embedder.
    """
    def _split_camel(match: re.Match) -> str:
        word = match.group(1)
        # Split CamelCase / camelCase into separate words
        spaced = re.sub(r"(?<!^)(?=[A-Z])", " ", word)
        return spaced

    return _HASHTAG_RE.sub(_split_camel, text)


def _normalize_punctuation(text: str) -> str:
    """Collapse repeated punctuation ('!!!','...') to a single mark — reduces noise, keeps emphasis."""
    return _MULTI_PUNCT_RE.sub(r"\1", text)

def _clean_text(raw: str) -> str:
    """Strip HTML, decode entities, remove boilerplate, emojis, and collapse whitespace."""
    if not raw:
        return ""
    text = html.unescape(raw)
    text = _HTML_TAG_RE.sub(" ", text)
    text = _BOILERPLATE_RE.sub(" ", text)
    text = _strip_emojis(text)
    text = _normalize_hashtags(text)
    text = _normalize_punctuation(text)
    text = _WHITESPACE_RE.sub(" ", text).strip()
    return text


def _is_english(text: str) -> bool:
    """Return True if text is detected as English with sufficient confidence."""
    try:
        return detect(text) == config.TARGET_LANGUAGE
    except LangDetectException:
        # If it's just punctuation/symbols, drop it safely
        return False


def _parse_views(views_text: str) -> int:
    """Parse YouTube view count string like '3,562 views' → 3562."""
    if not views_text:
        return 0
    nums = re.sub(r"[^\d]", "", views_text)
    return int(nums) if nums else 0


def _parse_datetime(date_input: Any) -> datetime.datetime:
    """Safely converts ISO strings, Unix timestamps, or relative 'X days ago' strings into UTC datetimes."""
    if not date_input:
        return datetime.datetime.now(datetime.timezone.utc)
        
    if isinstance(date_input, (int, float)):
        return datetime.datetime.fromtimestamp(date_input, tz=datetime.timezone.utc)
    
    date_str = str(date_input).strip().lower()
    
    # Handle YouTube/Reddit relative dates (e.g., "11 months ago", "4 days ago", "2mo ago", "10h ago")
    ago_match = re.search(r'(\d+)\s*(second|minute|hour|day|week|month|year|mo|d|h|m|s|y|yr)s?\s+ago', date_str)
    if ago_match:
        value = int(ago_match.group(1))
        unit = ago_match.group(2)
        
        now = datetime.datetime.now(datetime.timezone.utc)
        if unit in ('second', 's'): delta = datetime.timedelta(seconds=value)
        elif unit in ('minute', 'm'): delta = datetime.timedelta(minutes=value)
        elif unit in ('hour', 'h'): delta = datetime.timedelta(hours=value)
        elif unit in ('day', 'd'): delta = datetime.timedelta(days=value)
        elif unit in ('week', 'w'): delta = datetime.timedelta(weeks=value)
        elif unit in ('month', 'mo'): delta = datetime.timedelta(days=value * 30)
        elif unit in ('year', 'y', 'yr'): delta = datetime.timedelta(days=value * 365)
        else: delta = datetime.timedelta(0)
        
        return now - delta

    # Standard ISO format fallback for Reddit/HackerNews
    try:
        # Replace 'Z' with +00:00 for strict ISO parsing
        iso_str = date_str.replace("z", "+00:00")
        dt = datetime.datetime.fromisoformat(iso_str)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=datetime.timezone.utc)
        return dt
    except Exception:
        # Final safety net
        logger.warning(f"Could not parse date '{date_input}', falling back to current time.")
        return datetime.datetime.now(datetime.timezone.utc)


def _calculate_engagement(source: str, raw_score: int, num_comments: int, created_at: datetime.datetime) -> float:
    """
    Computes a compressed, platform-agnostic, and time-decayed engagement index.
    - Scales active metrics (likes, comments) preferentially over views.
    - Applies a log-transform to compress extreme virality scale variance.
    - Applies an exponential time-decay calculation based on age.
    """
    current_time = datetime.datetime.now(datetime.timezone.utc)
    
    if source in ["reddit", "hackerNews"]:
        # Comments reflect twice the activity index weight of passive upvotes
        base_engagement = float(raw_score + (num_comments * 2.0))
        
    elif source == "youtube":
        # Estimate likes as 2% of views if raw likes aren't available
        likes_estimate = raw_score * 0.02
        base_engagement = likes_estimate + (num_comments * 2.0)
    else:
        base_engagement = float(raw_score + num_comments)

    base_engagement = max(0.0, base_engagement)
    
    # Step 1: Logarithmic stabilization to handle severe viral distributions
    log_scaled = math.log1p(base_engagement)
    
    # Step 2: Temporal Time-Decay Calculation
    age_delta = current_time - created_at
    days_old = max(0.0, age_delta.total_seconds() / 86400.0)
    
    # Exponential decay formula: E * e^(-lambda * days)
    time_decay_factor = math.exp(-DECAY_LAMBDA * days_old)
    final_score = log_scaled * time_decay_factor
    
    return round(final_score, 4)


# ── Normalization Handlers ───────────────────────────────────────────────────

def _normalize_reddit(post: RedditPost, query: str) -> NormalizedItem | None:
    """Convert a Reddit post to a NormalizedItem, or None if junk."""
    if post.author in _REDDIT_BOT_AUTHORS:
        return None
        
    clean_title = _clean_text(post.title)
    clean_body = _clean_text(post.body) if post.body else ""
    
    if clean_title in _DELETED_MARKERS or clean_body in _DELETED_MARKERS:
        return None

    text = f"{clean_title}. {clean_body}".strip()

    if len(text.split()) < config.MIN_WORD_COUNT:
        return None
    if not _is_english(text):
        return None

    created_at = _parse_datetime(post.createdIso)
    engagement = _calculate_engagement("reddit", post.score, post.comments, created_at)

    return NormalizedItem(
        id=f"reddit_{post.postId}",
        source="reddit",
        query=query,
        text=text,
        title=clean_title,
        author=post.author,
        score=post.score,
        num_comments=post.comments,
        created_at=created_at.isoformat(),
        url=post.permalink,
        subreddit=post.subreddit,
        engagement=engagement,
    )


def _normalize_youtube(video: YouTubeVideo, query: str) -> NormalizedItem | None:
    """Convert a YouTube video to a NormalizedItem, or None if junk."""
    clean_title = _clean_text(video.title)
    clean_desc = _clean_text(video.description) if video.description else ""
    
    text = f"{clean_title}. {clean_desc}".strip()

    if len(text.split()) < config.MIN_WORD_COUNT:
        return None
    if not _is_english(text):
        return None

    views = _parse_views(video.viewsText)
    if views < config.YOUTUBE_MIN_VIEWS:
        return None

    created_at = _parse_datetime(video.publishedText)
    
    # Assuming comments aren't currently provided by the YT collector model
    comments = getattr(video, 'comments', 0)
    engagement = _calculate_engagement("youtube", views, comments, created_at)

    return NormalizedItem(
        id=f"youtube_{video.id}",
        source="youtube",
        query=query,
        text=text,
        title=clean_title,
        author=video.channelName,
        score=views,
        num_comments=comments,
        created_at=created_at.isoformat(),
        url=video.url,
        channel=video.channelName,
        engagement=engagement,
    )


def _normalize_hackernews(post: HackerNewsPost, query: str) -> NormalizedItem | None:
    """Convert a HackerNews post to a NormalizedItem, or None if junk."""
    clean_title = _clean_text(post.title) if post.title else ""
    clean_body = _clean_text(post.text) if post.text else ""
    
    if clean_title in _DELETED_MARKERS or clean_body in _DELETED_MARKERS:
        return None

    text = f"{clean_title}. {clean_body}".strip()

    if len(text.split()) < config.MIN_WORD_COUNT:
        return None
    if not _is_english(text):
        return None

    created_at = _parse_datetime(post.createdAt)
    engagement = _calculate_engagement("hackerNews", post.points, post.comments, created_at)

    return NormalizedItem(
        id=f"hackernews_{post.id}",
        source="hackerNews",
        query=query,
        text=text,
        title=clean_title,
        author=post.author,
        score=post.points,
        num_comments=post.comments,
        created_at=created_at.isoformat(),
        url=post.url or f"https://news.ycombinator.com/item?id={post.id}",
        engagement=engagement,
    )


def _normalize_instagram(post: InstagramPost, query: str) -> NormalizedItem | None:
    """Convert an Instagram post to a NormalizedItem, or None if junk."""
    clean_caption = _clean_text(post.caption) if post.caption else ""
    clean_transcript = _clean_text(post.transcript) if post.transcript else ""
    
    text = f"{clean_caption}. {clean_transcript}".strip()

    if len(text.split()) < config.MIN_WORD_COUNT:
        return None
    if not _is_english(text):
        return None

    created_at = _parse_datetime(post.taken_at)
    engagement = _calculate_engagement("instagram", post.like_count, post.comment_count, created_at)

    return NormalizedItem(
        id=f"instagram_{post.pk}",
        source="instagram",
        query=query,
        text=text,
        title=clean_caption[:100] + ("..." if len(clean_caption) > 100 else ""),
        author=post.username or post.full_name,
        score=post.like_count,
        num_comments=post.comment_count,
        created_at=created_at.isoformat(),
        url=post.url,
        engagement=engagement,
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

        # Instagram
        for ig_post in result.instagram:
            item = _normalize_instagram(ig_post, query)
            if item and item.id not in seen_ids:
                seen_ids.add(item.id)
                items.append(item)

    logger.info(f"Stage 0: {len(items)} normalized items from {len(data.results)} queries")
    return items