"""
Pydantic data models for every stage of the pipeline.
"""

from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional, Literal


# ── Input Models (mirrors collection-scored.json) ────────────────────────────

class RedditPost(BaseModel):
    rank: int = 0
    fullname: str = ""
    postId: str = ""
    title: str = ""
    body: str = ""
    permalink: str = ""
    author: str = ""
    subreddit: str = ""
    score: int = 0
    comments: int = 0
    createdIso: str = ""
    createdText: str = ""
    flair: str = ""
    rawHtml: str = ""


class YouTubeVideo(BaseModel):
    id: str = ""
    title: str = ""
    description: str = ""
    channelName: str = ""
    publishedText: str = ""
    duration: str = ""
    viewsText: str = ""
    url: str = ""
    verified: bool = False
    rank: int = 0


class GoogleTrendsEntry(BaseModel):
    method: str = ""
    interestOverTime: Optional[dict] = None
    relatedQueries: Optional[dict] = None
    relatedTopics: Optional[dict] = None


class HackerNewsPost(BaseModel):
    id: str = ""
    type: str = ""
    title: str = ""
    text: str = ""
    url: str = ""
    author: str = ""
    createdAt: str = ""
    points: int = 0
    comments: int = 0
    tags: list[str] = Field(default_factory=list)
    storyId: str = ""
    parentId: str = ""
    rank: int = 0


class CollectionResult(BaseModel):
    query: str
    candidateSource: str = ""
    errors: dict = Field(default_factory=dict)
    reddit: list[RedditPost] = Field(default_factory=list)
    youtube: list[YouTubeVideo] = Field(default_factory=list)
    googleTrends: list[GoogleTrendsEntry] = Field(default_factory=list)
    hackerNews: list[HackerNewsPost] = Field(default_factory=list)


class CollectionScored(BaseModel):
    seed: str
    rateLimitFailures: list[dict] = Field(default_factory=list)
    results: list[CollectionResult] = Field(default_factory=list)


# ── Stage 0: Normalized Item ────────────────────────────────────────────────

class NormalizedItem(BaseModel):
    """Flat, source-agnostic representation of a content item."""
    id: str                         # e.g. "reddit_1txj10d" or "youtube_RKbmqSRc0z0"
    source: str                     # "reddit" | "youtube"
    query: str                      # which expanded query found this item
    text: str                       # cleaned concatenated title + body
    title: str = ""
    author: str = ""
    score: int = 0                  # reddit upvotes or youtube views (parsed)
    num_comments: int = 0           # reddit comments count
    created_at: str = ""            # ISO timestamp
    url: str = ""
    subreddit: str = ""             # reddit-only
    channel: str = ""               # youtube-only
    engagement: float = 0.0         # normalized engagement metric
    evidence_ids: list[str] = Field(default_factory=list)  # Added for grouping duplicates in Stage 3


# ── Stage 1-2: Scored Item ───────────────────────────────────────────────────

class ScoredItem(NormalizedItem):
    """NormalizedItem augmented with relevance scores."""
    relevance_score: float = 0.0    # bi-encoder cosine sim (stage 1)
    rerank_score: float = 0.0       # cross-encoder score (stage 2)


# ── Stage 4: Clustered Item ─────────────────────────────────────────────────

class ClusteredItem(ScoredItem):
    """ScoredItem with cluster assignment."""
    cluster_id: int = -1            # HDBSCAN label (-1 = noise)


# ── Stage 5: Extracted Signal ────────────────────────────────────────────────

class ExtractedSignal(BaseModel):
    """Structured signal extracted from a cluster via LLM."""
    cluster_id: int
    is_anomaly: bool = False        # True if extracted from noise cluster (-1)
    entity: str = ""                # product/tool mentioned
    pain_point: str = ""
    feature_request: str = ""
    sentiment: str = ""             # positive / negative / neutral / mixed
    intent: str = ""                # purchase_evaluation / venting / question / comparison
    summary: str = ""               # 1-2 sentence cluster summary
    evidence_count: int = 0         # number of items in cluster
    evidence_ids: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)  # unique sources represented
    representative_quotes: list[str] = Field(default_factory=list)
    avg_relevance: float = 0.0
    avg_engagement: float = 0.0


# ── Stage 6: Merged Signal ──────────────────────────────────────────────────

class MergedSignal(BaseModel):
    """Signals merged across clusters/sources."""
    signal_id: str
    is_anomaly: bool = False        # True if merged from anomaly signals
    entities: list[str] = Field(default_factory=list)
    pain_points: list[str] = Field(default_factory=list)
    feature_requests: list[str] = Field(default_factory=list)
    sentiment: str = ""
    intents: list[str] = Field(default_factory=list)
    summary: str = ""
    evidence_count: int = 0
    evidence_ids: list[str] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    representative_quotes: list[str] = Field(default_factory=list)
    avg_relevance: float = 0.0
    avg_engagement: float = 0.0
    # Scoring components (filled in stage 7)
    relevance_component: float = 0.0
    evidence_component: float = 0.0
    velocity_component: float = 0.0
    source_spread_component: float = 0.0
    engagement_component: float = 0.0
    novelty_component: float = 0.0
    final_score: float = 0.0


# ── Stage 8: Final Output ───────────────────────────────────────────────────

class AnalysisOutput(BaseModel):
    """Final compressed output for the LLM analyst."""
    topic: str
    top_pain_points: list[dict] = Field(default_factory=list)
    top_feature_requests: list[dict] = Field(default_factory=list)
    top_questions: list[dict] = Field(default_factory=list)
    representative_quotes: list[dict] = Field(default_factory=list)
    signals: list[MergedSignal] = Field(default_factory=list)
    stats: dict = Field(default_factory=dict)


# ── Stage 9: Final Synthesis ────────────────────────────────────────────────

class TrendMetrics(BaseModel):
    impressions: int = 0
    views: int = 0
    engagement_rate: float = 0.0
    likes: int = 0
    comments: int = 0
    shares: int = 0
    velocity: str = ""

class TrendCatcher(BaseModel):
    trend: str = ""
    platform: str = ""
    status: str = ""
    trend_type: Literal["mainstream", "counter_trend"] = "mainstream"
    confidence: Literal["high", "medium", "low"] = "medium"
    metrics: TrendMetrics = Field(default_factory=TrendMetrics)
    suggested_content: str = ""
    format: str = ""
    angle: str = ""
    reference_links: list[str] = Field(default_factory=list)
    act_by: str = ""
    representative_id: str = ""
    evidence_ids: list[str] = Field(default_factory=list)

class TokenUsage(BaseModel):
    stage: str
    model: str
    prompt_tokens: int
    output_tokens: int
    total_tokens: int

class FinalSynthesisOutput(BaseModel):
    topic: str = ""
    trend_catchers: list[TrendCatcher] = Field(default_factory=list)
    raw_analysis: Optional[AnalysisOutput] = None
    token_usage: list[TokenUsage] = Field(default_factory=list)
    posts_by_id: dict[str, NormalizedItem] = Field(default_factory=dict)
