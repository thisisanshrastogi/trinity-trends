"""
Stage 9: Final Synthesis

Takes the compressed analysis output and feeds it to a Gemini 3+ LLM to generate
actionable "Trend Catchers" for content creators, utilizing Structured Outputs 
and dynamic reasoning (thinking) to guarantee reliable, high-quality results.
"""

import json
import logging
from typing import Any

from google import genai
from google.genai import types
from google.genai.types import GenerateContentConfig
from pydantic import BaseModel

from pipeline.models import AnalysisOutput, FinalSynthesisOutput, TrendCatcher, TrendMetrics, TokenUsage
from pipeline import config
from pipeline.stages.s5_extract import _get_client

logger = logging.getLogger(__name__)

# ── Temporary Schema for Enforced LLM Output ─────────────────────────────────

class LLMSynthesisOutput(BaseModel):
    """Schema used strictly to enforce the LLM's JSON output structure via the API."""
    topic: str
    trend_catchers: list[TrendCatcher]


# ── Prompt ──────────────────────────────────────────────────────────────────

_SYNTHESIS_PROMPT = """\
You are an expert trend analyst specializing in identifying emerging content opportunities from large-scale social media discussion data.

Your job is NOT to summarize the data.
Your job is to identify trends that are actionable RIGHT NOW.

The input is a compressed analysis generated from Reddit, YouTube, TikTok, Instagram, Hacker News, Product Hunt, Quora, Google Trends and similar sources.

The report contains:
- recurring pain points
- feature requests
- frequently asked questions
- representative discussions
- engagement metrics
- temporal information
- representative URLs

------------------------------------------------------------
WHAT IS A TREND?
------------------------------------------------------------
A trend is NOT simply a popular topic.
A trend must satisfy at least one of these:
• engagement is increasing rapidly
• discussion volume is increasing
• search interest is increasing
• many creators are independently covering the same idea
• a new angle or format is appearing repeatedly
• people are asking for content that doesn't exist yet

Prefer trends that still have runway.
Avoid trends that are already completely saturated unless the analysis explicitly shows continued acceleration.

------------------------------------------------------------
HOW TO DETERMINE TREND STATUS
------------------------------------------------------------
status = rising
Use when:
- discussion growth is accelerating
- engagement is increasing
- few creators are covering it
- momentum appears early

status = peaking
Use when:
- engagement is extremely high
- many creators are already covering it
- growth is slowing
- saturation appears close

------------------------------------------------------------
CONFIDENCE & SCORING PRIORITY
------------------------------------------------------------
Only emit trends supported by evidence.
Multiple weak signals across platforms are stronger than one viral post.
If evidence is weak, omit the trend entirely. Quality is preferred over quantity.

Prioritize trends that maximize:
1. growth velocity
2. audience demand
3. uniqueness
4. content opportunity
5. time sensitivity

------------------------------------------------------------
METRICS & REFERENCE LINKS
------------------------------------------------------------
Use metrics from the analysis whenever available. Never fabricate numbers.
If a metric is unavailable, return null or 0.
Extract URLs when present. Deduplicate.

------------------------------------------------------------
CONTENT RECOMMENDATION & ANGLE
------------------------------------------------------------
The suggested content should be something a creator could publish immediately.
Avoid generic suggestions like "make a video".
Instead write: "Benchmark Claude Code vs Cursor using a real production repository."

The angle should explain WHY this trend matters.
Good: "Everyone shows the success stories. Show where it fails."
Bad: "Talk about the trend."

------------------------------------------------------------
INPUT
------------------------------------------------------------
Topic:
{topic}

Analysis:
{analysis_json}
"""

def synthesize_trends(analysis: AnalysisOutput, min_score: float = 0.0) -> FinalSynthesisOutput:
    """
    Takes the compressed analysis and generates actionable trend catchers.
    Filters out signals and related data below `min_score` to manage LLM payload size.
    """
    # Filter content before dumping to LLM to save tokens and manage window limits
    filtered_analysis = analysis.model_copy(deep=True)
    if min_score > 0:
        filtered_analysis.signals = [s for s in filtered_analysis.signals if s.final_score >= min_score]
        filtered_analysis.top_pain_points = [p for p in filtered_analysis.top_pain_points if p.get("score", 0) >= min_score]
        filtered_analysis.top_feature_requests = [f for f in filtered_analysis.top_feature_requests if f.get("score", 0) >= min_score]
        filtered_analysis.top_questions = [q for q in filtered_analysis.top_questions if q.get("score", 0) >= min_score]
        logger.info(f"Stage 9: Filtered payload with min_score={min_score}. Kept {len(filtered_analysis.signals)}/{len(analysis.signals)} signals.")
    
    logger.info(f"Stage 9: Synthesizing final trends for topic '{analysis.topic}'")
    
    client = _get_client()
    
    prompt = _SYNTHESIS_PROMPT.format(
        topic=analysis.topic,
        analysis_json=json.dumps(filtered_analysis.model_dump(), indent=2)[:40000] # Cap safely to avoid overflow
    )
    
    try:
        # Request generation with enforced schema and advanced dynamic reasoning
        response = client.models.generate_content(
            model=config.GEMINI_MODEL,  # e.g., "gemini-3.1-flash-lite" or "gemini-3.1-pro-preview"
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=1.0,  # 1.0 is the recommended standard when thinking is enabled
                max_output_tokens=8192,  # Increased to give ample room for thoughts + final JSON payload
                response_mime_type="application/json",
                response_schema=LLMSynthesisOutput,  # API natively guarantees valid JSON matching this schema
                thinking_config=types.ThinkingConfig(thinking_level="high"),  # Activates Gemini 3+ reasoning
            ),
        )
        
        # Because response_schema is used, the response text is guaranteed clean JSON without markdown fences
        text = response.text.strip()
        parsed: dict[str, Any] = json.loads(text)
        
        # Hydrate the raw JSON response into structural Pydantic objects safely
        catchers = []
        for tc_raw in parsed.get("trend_catchers", []):
            metrics_raw = tc_raw.get("metrics", {})
            metrics = TrendMetrics(
                impressions=metrics_raw.get("impressions", 0) or 0,
                views=metrics_raw.get("views", 0) or 0,
                engagement_rate=metrics_raw.get("engagement_rate", 0.0) or 0.0,
                likes=metrics_raw.get("likes", 0) or 0,
                comments=metrics_raw.get("comments", 0) or 0,
                shares=metrics_raw.get("shares", 0) or 0,
                velocity=metrics_raw.get("velocity", "") or ""
            )
            
            catcher = TrendCatcher(
                trend=tc_raw.get("trend", ""),
                platform=tc_raw.get("platform", ""),
                status=tc_raw.get("status", "rising"),
                metrics=metrics,
                suggested_content=tc_raw.get("suggested_content", ""),
                format=tc_raw.get("format", ""),
                angle=tc_raw.get("angle", ""),
                reference_links=tc_raw.get("reference_links", []),
                act_by=tc_raw.get("act_by", "")
            )
            catchers.append(catcher)
            
        usage = []
        if response.usage_metadata:
            usage.append(TokenUsage(
                stage="synthesize",
                model=config.GEMINI_MODEL,
                prompt_tokens=response.usage_metadata.prompt_token_count,
                output_tokens=response.usage_metadata.candidates_token_count,
                total_tokens=response.usage_metadata.total_token_count
            ))

        final_output = FinalSynthesisOutput(
            topic=analysis.topic,
            trend_catchers=catchers,
            raw_analysis=analysis,
            token_usage=usage
        )
        
        logger.info(f"Stage 9: Successfully generated {len(catchers)} trend catchers")
        return final_output
        
    except Exception as e:
        logger.error(f"Failed to synthesize trends due to error: {e}")
        # Fallback to an empty trend catcher list wrapped with the original raw analysis
        return FinalSynthesisOutput(
            topic=analysis.topic,
            trend_catchers=[],
            raw_analysis=analysis
        )