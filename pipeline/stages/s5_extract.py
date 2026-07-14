"""
Stage 5 — Extract structured signals from each cluster via LLM.

This is one of only two LLM stages in the pipeline. For each cluster,
we take the top N documents (by engagement) and send them in a single
prompt to Gemini, extracting:
  - entity (product/tool mentioned)
  - pain_point
  - feature_request
  - sentiment
  - intent
  - summary

Using structured output (JSON mode) for reliable parsing.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any

from google import genai
from google.genai.types import GenerateContentConfig

from pipeline.models import ClusteredItem, ExtractedSignal, TokenUsage
from pipeline import config

logger = logging.getLogger(__name__)

_client: genai.Client | None = None


def _get_client() -> genai.Client:
    global _client
    if _client is None:
        _client = genai.Client(api_key=config.GEMINI_API_KEY)
    return _client


_EXTRACTION_PROMPT = """\
You are analyzing a cluster of social media posts that are all about the same subtopic. \
Extract structured information from these posts.

**Topic context:** {seed_query}
**Cluster contains {n_items} posts from sources: {sources}**

Here are the top posts (by engagement):

{posts_text}

Extract the following as JSON:
{{
  "entity": "the main product, tool, or technology discussed (string, empty if none specific)",
  "pain_point": "the main complaint or problem users express (string, empty if none)",
  "feature_request": "what users want that doesn't exist yet (string, empty if none)",
  "sentiment": "overall sentiment: positive | negative | neutral | mixed",
  "intent": "dominant user intent: purchase_evaluation | venting | question | comparison | discussion | announcement",
  "summary": "1-2 sentence summary of what this cluster is about"
}}

Return ONLY valid JSON, no markdown fences.
"""


def _format_post(item: ClusteredItem, idx: int) -> str:
    """Format a single item for the LLM prompt."""
    source_info = f"[{item.source}]"
    if item.source == "reddit":
        source_info += f" r/{item.subreddit} | ↑{item.score} | {item.num_comments} comments"
    elif item.source == "youtube":
        source_info += f" {item.channel} | {item.score} views"

    # Truncate text to ~500 chars to keep prompt manageable
    text = item.text[:500]
    if len(item.text) > 500:
        text += "..."

    return f"Post {idx + 1} {source_info}:\n{text}\n"


def extract_signals(
    clusters: dict[int, list[ClusteredItem]],
    seed_query: str,
) -> list[ExtractedSignal]:
    """
    Stage 5 entry point.

    Makes one LLM call per cluster (not per document) to extract
    structured signals. Batches representative docs from each cluster.

    Args:
        clusters: Dict mapping cluster_id → list of items
        seed_query: The original seed query

    Returns:
        Tuple of (List of ExtractedSignals, List of TokenUsages)
    """
    if not clusters:
        return [], []

    client = _get_client()
    signals: list[ExtractedSignal] = []
    token_usages: list[TokenUsage] = []

    for cluster_id, items in sorted(clusters.items()):
        # Sort by engagement and take top N
        top_items = sorted(items, key=lambda x: x.engagement, reverse=True)
        top_items = top_items[: config.MAX_DOCS_PER_CLUSTER]

        sources = list(set(item.source for item in items))
        posts_text = "\n".join(
            _format_post(item, i) for i, item in enumerate(top_items)
        )

        prompt = _EXTRACTION_PROMPT.format(
            seed_query=seed_query,
            n_items=len(items),
            sources=", ".join(sources),
            posts_text=posts_text,
        )

        try:
            response = client.models.generate_content(
                model=config.GEMINI_MODEL,
                contents=prompt,
                config=GenerateContentConfig(
                    temperature=0.1,
                    max_output_tokens=2048,
                    thinking_config={"thinking_budget": 0},
                ),
            )

            # Parse JSON response
            text = response.text.strip()
            logger.debug(f"  Cluster {cluster_id} raw LLM response: {text[:200]}")

            if response.usage_metadata:
                token_usages.append(TokenUsage(
                    stage="extract_signals",
                    model=config.GEMINI_MODEL,
                    prompt_tokens=response.usage_metadata.prompt_token_count,
                    output_tokens=response.usage_metadata.candidates_token_count,
                    total_tokens=response.usage_metadata.total_token_count
                ))

            # Robust markdown fence stripping
            fence_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?\s*```', text, re.DOTALL)
            if fence_match:
                text = fence_match.group(1).strip()

            parsed: dict[str, Any] = json.loads(text)

            # Collect representative quotes (first ~80 chars of top posts)
            quotes = []
            for item in top_items[:5]:
                quote = item.text[:80].strip()
                if len(item.text) > 80:
                    quote += "..."
                quotes.append(quote)

            signal = ExtractedSignal(
                cluster_id=cluster_id,
                entity=parsed.get("entity", ""),
                pain_point=parsed.get("pain_point", ""),
                feature_request=parsed.get("feature_request", ""),
                sentiment=parsed.get("sentiment", "neutral"),
                intent=parsed.get("intent", "discussion"),
                summary=parsed.get("summary", ""),
                evidence_count=len(items),
                sources=sources,
                representative_quotes=quotes,
                avg_relevance=sum(i.relevance_score for i in items) / len(items),
                avg_engagement=sum(i.engagement for i in items) / len(items),
            )
            signals.append(signal)

            logger.info(
                f"  Cluster {cluster_id}: entity={signal.entity!r}, "
                f"sentiment={signal.sentiment}, evidence={signal.evidence_count}"
            )

        except json.JSONDecodeError as e:
            logger.warning(f"  Cluster {cluster_id}: JSON parse error: {e}")
            # Create a fallback signal from the raw data
            signals.append(ExtractedSignal(
                cluster_id=cluster_id,
                summary=f"Cluster of {len(items)} items (LLM extraction failed)",
                evidence_count=len(items),
                sources=sources,
                avg_relevance=sum(i.relevance_score for i in items) / len(items),
                avg_engagement=sum(i.engagement for i in items) / len(items),
            ))

        except Exception as e:
            logger.error(f"  Cluster {cluster_id}: LLM error: {e}")
            signals.append(ExtractedSignal(
                cluster_id=cluster_id,
                summary=f"Cluster of {len(items)} items (LLM error: {e})",
                evidence_count=len(items),
                sources=sources,
            ))

    logger.info(f"Stage 5: extracted {len(signals)} signals from {len(clusters)} clusters")
    return signals, token_usages
