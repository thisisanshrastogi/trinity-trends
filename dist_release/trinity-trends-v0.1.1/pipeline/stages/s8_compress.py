"""
Stage 8 — Evidence compression (final LLM-ready payload).

Builds the compact, deduped payload that gets fed to the final
LLM analyst prompt. This is small (few hundred tokens), dense,
and includes:
  - Top pain points
  - Top feature requests
  - Top questions/discussion topics
  - Representative quotes with source links
  - Aggregate stats
"""

from __future__ import annotations

import logging

from pipeline.models import MergedSignal, AnalysisOutput

logger = logging.getLogger(__name__)


def compress(
    signals: list[MergedSignal],
    seed_query: str,
    total_evidence: int = 0,
) -> AnalysisOutput:
    """
    Stage 8 entry point.

    Compresses scored signals into a compact analyst-ready payload.

    Args:
        signals: Scored, sorted signals from Stage 7
        seed_query: The original seed query
        total_evidence: Total number of items before filtering

    Returns:
        AnalysisOutput ready for LLM synthesis
    """
    # Separate signals by type
    pain_points: list[dict] = []
    feature_requests: list[dict] = []
    questions: list[dict] = []

    for signal in signals:
        entry = {
            "signal_id": signal.signal_id,
            "is_anomaly": signal.is_anomaly,
            "summary": signal.summary,
            "entities": signal.entities,
            "sentiment": signal.sentiment,
            "evidence_count": signal.evidence_count,
            "sources": signal.sources,
            "score": signal.final_score,
        }

        # Categorize by what the signal contains
        for pp in signal.pain_points:
            if pp:
                pain_points.append({**entry, "pain_point": pp})

        for fr in signal.feature_requests:
            if fr:
                feature_requests.append({**entry, "feature_request": fr})

        # Classify question/discussion signals by intent
        if any(i in ("question", "discussion", "comparison") for i in signal.intents):
            questions.append(entry)

    # Collect representative quotes from top signals
    quotes: list[dict] = []
    for signal in signals[:5]:
        for quote in signal.representative_quotes[:1]:
            quotes.append({
                "text": quote,
                "sources": signal.sources,
                "entities": signal.entities,
            })

    # Aggregate stats
    all_sources = set()
    total_signal_evidence = 0
    for s in signals:
        all_sources.update(s.sources)
        total_signal_evidence += s.evidence_count

    stats = {
        "total_evidence": total_evidence or total_signal_evidence,
        "total_signals": len(signals),
        "sources": sorted(all_sources),
        "top_signal_score": signals[0].final_score if signals else 0,
    }

    output = AnalysisOutput(
        topic=seed_query,
        top_pain_points=sorted(pain_points, key=lambda x: x["score"], reverse=True)[:6],
        top_feature_requests=sorted(feature_requests, key=lambda x: x["score"], reverse=True)[:4],
        top_questions=sorted(questions, key=lambda x: x["score"], reverse=True)[:8],
        representative_quotes=quotes[:5],
        signals=signals,
        stats=stats,
    )

    logger.info(
        f"Stage 8: compressed to {len(output.top_pain_points)} pain points, "
        f"{len(output.top_feature_requests)} feature requests, "
        f"{len(output.top_questions)} questions, "
        f"{len(output.representative_quotes)} quotes"
    )

    return output
