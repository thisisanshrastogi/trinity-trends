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
        format="%(message)s",
        stream=sys.stdout,
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




if __name__ == "__main__":
    main()
