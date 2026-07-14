"""
CLI entry point for the Trinity Trends analysis pipeline.

Usage:
    python -m pipeline.run                        # Use defaults
    python -m pipeline.run --input path/to.json   # Custom input
    python -m pipeline.run --output path/out.json  # Custom output
    python -m pipeline.run -v                      # Verbose logging
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from pipeline import config
from pipeline.runner import run_pipeline
from pipeline.models import FinalSynthesisOutput


def main():
    parser = argparse.ArgumentParser(
        description="Trinity Trends Analysis Pipeline — 9-stage signal extraction"
    )
    parser.add_argument(
        "--input", "-i",
        type=Path,
        default=config.INPUT_FILE,
        help=f"Input collection-scored.json (default: {config.INPUT_FILE})",
    )
    parser.add_argument(
        "--output", "-o",
        type=Path,
        default=config.RESULT_FILE,
        help=f"Output analysis-result.json (default: {config.RESULT_FILE})",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable debug logging",
    )
    parser.add_argument(
        "--start-stage",
        type=int,
        default=0,
        help="Stage to start from (0-9)",
    )
    parser.add_argument(
        "--end-stage",
        type=int,
        default=9,
        help="Stage to end at (0-9)",
    )
    parser.add_argument(
        "--state-file",
        type=Path,
        default=Path("pipeline_state.pkl"),
        help="File to save/load intermediate state",
    )
    args = parser.parse_args()

    # Configure logging
    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )

    # Validate input exists
    if not args.input.exists():
        logging.error(f"Input file not found: {args.input}")
        sys.exit(1)

    # Run the pipeline
    output = run_pipeline(
        input_path=args.input, 
        output_path=args.output,
        start_stage=args.start_stage,
        end_stage=args.end_stage,
        state_file=args.state_file
    )

    if not isinstance(output, FinalSynthesisOutput):
        return

    # Print summary to stdout
    print(f"\n{'='*60}")
    print(f"  PIPELINE COMPLETE — {output.topic}")
    print(f"{'='*60}")
    print(f"  Trend Catchers:     {len(output.trend_catchers)}")
    if output.raw_analysis:
        print(f"  Signals found:      {len(output.raw_analysis.signals)}")
        print(f"  Pain points:        {len(output.raw_analysis.top_pain_points)}")
        print(f"  Feature requests:   {len(output.raw_analysis.top_feature_requests)}")
        print(f"  Questions:          {len(output.raw_analysis.top_questions)}")
        print(f"  Total evidence:     {output.raw_analysis.stats.get('total_evidence', '?')}")
        print(f"  Sources:            {', '.join(output.raw_analysis.stats.get('sources', []))}")
    print(f"  Output:             {args.output}")
    print(f"{'='*60}\n")

    if output.raw_analysis and output.raw_analysis.top_pain_points:
        print("  Top Pain Points:")
        for i, pp in enumerate(output.raw_analysis.top_pain_points[:3], 1):
            print(f"    {i}. {pp.get('pain_point', pp.get('summary', ''))}")
        print()

    if output.raw_analysis and output.raw_analysis.top_feature_requests:
        print("  Top Feature Requests:")
        for i, fr in enumerate(output.raw_analysis.top_feature_requests[:3], 1):
            print(f"    {i}. {fr.get('feature_request', fr.get('summary', ''))}")
        print()


if __name__ == "__main__":
    main()
