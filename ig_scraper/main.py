#!/usr/bin/env python3
"""CLI: direct scrape (default) or optional Google ADK agent mode."""

from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

from results import ResultsStore
from scraper import run_scrape
from utils.config import AppConfig, load_config, require_instagram_credentials
from utils.logging_setup import setup_logging
from utils.paths import DEFAULT_OUTPUT

root_env = Path(__file__).parent.parent / ".env"
if root_env.exists():
    load_dotenv(dotenv_path=root_env)
else:
    load_dotenv()
logger = logging.getLogger("instagram_agent")

APP_NAME = "instagram_scraper_app"
USER_ID = "user_01"
SESSION_ID = "session_01"


async def run_direct(config: AppConfig, output: Path, search_type: str = "hashtag") -> int:
    try:
        username, password = require_instagram_credentials()
    except RuntimeError as e:
        logger.error("%s", e)
        return 1

    if not config.hashtags:
        logger.error("No queries configured in config.json")
        return 1

    logger.info(
        "Direct scrape: %s queries, target=%s, search_type=%s, headless=%s, agent_browser=%s → %s",
        len(config.hashtags),
        config.posts_per_hashtag,
        search_type,
        config.headless,
        config.agent_browser_on_challenge,
        output,
    )
    logger.info("Queries: %s", ", ".join(config.hashtags))

    store = ResultsStore(output_path=output, target_per_hashtag=config.posts_per_hashtag)
    await run_scrape(
        config.hashtags,
        username,
        password,
        search_type=search_type,
        target_count=config.posts_per_hashtag,
        config=config,
        store=store,
    )

    print(store.summary())
    if store.total_posts == 0:
        logger.error("No posts collected")
        return 1
    if store.failed_hashtags:
        logger.warning("Partial success; failed: %s", ", ".join(store.failed_hashtags))
        return 2
    logger.info("Done!")
    return 0


async def run_agent(config: AppConfig, search_type: str = "hashtag") -> int:
    try:
        require_instagram_credentials()
    except RuntimeError as e:
        logger.error("%s", e)
        return 1
    if not os.getenv("GOOGLE_API_KEY") and not os.getenv("GEMINI_API_KEY"):
        logger.error("GOOGLE_API_KEY or GEMINI_API_KEY required for --agent mode")
        return 1

    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types

    from agent import get_store, root_agent

    store = get_store()
    runner = Runner(
        agent=root_agent,
        app_name=APP_NAME,
        session_service=InMemorySessionService(),
    )
    await runner.session_service.create_session(
        app_name=APP_NAME, user_id=USER_ID, session_id=SESSION_ID
    )

    prompt = (
        f"Scrape Instagram posts for these {search_type}s: {', '.join(config.hashtags)}\n"
        f"Target: {config.posts_per_hashtag} posts per {search_type}\n\n"
        "Call scrape_all() then save_results()."
    )
    print("Prompt:\n" + prompt + "\n---\n")

    content = types.Content(role="user", parts=[types.Part(text=prompt)])
    async for event in runner.run_async(
        session_id=SESSION_ID, user_id=USER_ID, new_message=content
    ):
        if not (event.content and event.content.parts):
            continue
        for part in event.content.parts:
            if getattr(part, "text", None) and part.text.strip():
                tag = "[Final]" if event.is_final_response() else "[Agent]"
                print(f"{tag} {part.text}")
            elif getattr(part, "function_call", None) and part.function_call:
                print(f"[Tool Call] {part.function_call.name}({part.function_call.args})")
            elif getattr(part, "function_response", None) and part.function_response:
                resp = str(part.function_response.response)
                if len(resp) > 200:
                    resp = resp[:200] + "..."
                print(f"[Tool Response] {part.function_response.name}: {resp}")

    if not store.total_posts:
        logger.error("Agent finished with no posts")
        return 1
    store.save()
    print(store.summary())
    return 2 if store.failed_hashtags else 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Scrape Instagram post URLs by hashtag or keyword")
    p.add_argument("--agent", action="store_true", help="Use Google ADK agent mode")
    p.add_argument("--config", type=Path, default=None, help="Path to config.json")
    p.add_argument("--output", type=Path, default=None, help="Results JSON path")
    p.add_argument("-v", "--verbose", action="store_true", help="Debug logging")
    p.add_argument("--search-type", choices=["hashtag", "keyword"], default="hashtag", help="Search by hashtag or keyword")
    p.add_argument("-q", "--query", type=str, help="Comma-separated list of hashtags or keywords to search (overrides config.json)")
    p.add_argument("-c", "--count", type=int, default=None, help="Number of posts to collect per query (overrides config.json)")
    return p.parse_args(argv)


async def async_main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    setup_logging(verbose=args.verbose)
    config = load_config(args.config)
    if args.query:
        config.hashtags = [q.strip() for q in args.query.split(",") if q.strip()]
    if args.count is not None:
        config.posts_per_hashtag = args.count
    output = args.output or DEFAULT_OUTPUT
    return await (
        run_agent(config, search_type=args.search_type) 
        if args.agent 
        else run_direct(config, output, search_type=args.search_type)
    )


def main() -> None:
    try:
        code = asyncio.run(async_main())
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        code = 130
    sys.exit(code)


if __name__ == "__main__":
    main()
