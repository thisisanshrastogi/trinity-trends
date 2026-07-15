"""
Orchestrator for the Python data understanding pipeline.

This reads raw collected data for a specific session from SQLite,
formats it into the required CollectionScored model, runs the 9-stage pipeline,
and saves the result back into SQLite and LanceDB.
"""

import json
import logging
import time
import uuid
from typing import Any

from pipeline.models import CollectionScored, CollectionResult
from pipeline.runner import run_pipeline
from pipeline.storage.sqlite_client import SqliteClient
from pipeline.storage.lance_client import LanceClient
from pipeline.stages.s1_relevance import get_embeddings

logger = logging.getLogger(__name__)

class PipelineOrchestrator:
    def __init__(self):
        self.sqlite = SqliteClient()
        self.lance = LanceClient()

    def run_for_session(self, session_id: str, seed_query: str, min_score: float = 0.0):
        """
        Runs the full analysis pipeline for a given session.
        """
        logger.info(f"Starting orchestrator for session {session_id}")
        self.sqlite.initialize()

        run_id = str(uuid.uuid4())
        self.sqlite.create_pipeline_run(
            run_id=run_id,
            session_id=session_id,
            stage="data_analysis",
            status="running",
            started_at=int(time.time() * 1000)
        )

        try:
            # 1. Fetch raw collected data from SQLite
            raw_records = self.sqlite.get_collector_results_by_session(session_id)
            if not raw_records:
                raise ValueError(f"No collector results found for session {session_id}")

            # Group by topic/query to construct CollectionResult objects
            results_by_query = {}
            
            for record in raw_records:
                query = record["query"]
                platform = record["platform"]
                raw_json = json.loads(record["result_json"])
                
                if query not in results_by_query:
                    results_by_query[query] = CollectionResult(query=query)
                    
                cr = results_by_query[query]
                
                # Assign to correct platform list
                if platform == "reddit":
                    cr.reddit.extend(raw_json)
                elif platform == "youtube":
                    cr.youtube.extend(raw_json)
                elif platform == "googleTrends":
                    cr.googleTrends.extend(raw_json)
                # HN can be added here once modeled

            collection_data = CollectionScored(
                seed=seed_query,
                results=list(results_by_query.values())
            )

            # 2. Run the pipeline (passing the data object directly instead of a file)
            # Since pipeline.runner currently reads from file if no args are passed,
            # we need to slightly tweak or wrap the runner logic, or write it to a temp file.
            # To be robust without changing the runner API too much, we can just write it to a temp json.
            import tempfile
            from pathlib import Path
            
            with tempfile.TemporaryDirectory() as tmpdir:
                input_path = Path(tmpdir) / "input.json"
                output_path = Path(tmpdir) / "output.json"
                
                with open(input_path, "w") as f:
                    f.write(collection_data.model_dump_json())
                    
                output = run_pipeline(input_path=input_path, output_path=output_path, min_score=min_score)

            # 3. Save results to SQLite
            analysis_json = output.model_dump_json()
            signal_count = len(output.trend_catchers)
            
            self.sqlite.save_analysis_result(
                record_id=str(uuid.uuid4()),
                session_id=session_id,
                topic=seed_query,
                result_json=analysis_json,
                signal_count=signal_count,
                created_at=int(time.time() * 1000)
            )
            
            # 4. Save Embeddings to LanceDB
            # We want to store the generated trend catchers so they can be vector-searched later.
            if output.trend_catchers:
                import numpy as np
                import asyncio
                from pipeline.stages.s1_relevance import process_embeddings
                
                records = []
                for tc in output.trend_catchers:
                    # Using the trend angle as the embedding text
                    records.append({
                        "id": str(uuid.uuid4()),
                        "text": tc.trend + " - " + tc.angle,
                        "session_id": session_id,
                        "topic": seed_query,
                        "score": 1.0 # Trend catchers are top priority
                    })
                
                texts = [r["text"] for r in records]
                embeddings, tokens = asyncio.run(process_embeddings(texts, "RETRIEVAL_DOCUMENT"))
                
                for r, e in zip(records, embeddings):
                    r["vector"] = e.tolist()
                
                self.lance.add_to_table("analysis_signals", records)
                logger.info(f"Saved {len(records)} trend embeddings to LanceDB")

            # 5. Mark PipelineRun as completed
            self.sqlite.update_pipeline_run(
                run_id=run_id,
                status="completed",
                completed_at=int(time.time() * 1000),
                result_summary=json.dumps({"trend_catchers_count": signal_count, "topic": seed_query})
            )
            logger.info("Orchestrator finished successfully.")
            return output

        except Exception as e:
            logger.error(f"Orchestrator failed: {e}")
            self.sqlite.update_pipeline_run(
                run_id=run_id,
                status="failed",
                completed_at=int(time.time() * 1000),
                error=str(e)
            )
            raise

if __name__ == "__main__":
    import argparse
    import sys
    
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-id", required=True, help="UUID of the session")
    parser.add_argument("--seed", required=True, help="The seed query")
    parser.add_argument("--min-score", type=float, default=0.0, help="Minimum score threshold for sending signals to the final LLM synthesis stage")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()
    
    level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(level=level, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    
    # We suppress third party logs
    logging.getLogger("httpx").setLevel(logging.WARNING)
    
    orchestrator = PipelineOrchestrator()
    orchestrator.run_for_session(args.session_id, args.seed, min_score=args.min_score)
