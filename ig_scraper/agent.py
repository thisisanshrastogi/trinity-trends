"""Optional Google ADK agent wrapper around the scraper."""

from __future__ import annotations

import logging

from google.adk.agents import LlmAgent
from google.adk.tools import FunctionTool

from results import ResultsStore
from scraper import run_scrape
from utils.config import load_config, require_instagram_credentials
from utils.helpers import parse_hashtags
from utils.models import gemini_flash
from utils.paths import DEFAULT_OUTPUT

logger = logging.getLogger("instagram_agent.agent")

_store = ResultsStore(output_path=DEFAULT_OUTPUT)


def get_store() -> ResultsStore:
    return _store


def save_results() -> str:
    """Save all collected Instagram post URLs and return a summary."""
    _store.save()
    return _store.summary()


async def scrape_all(hashtags_csv: str, target_count: int = 200) -> str:
    """Scrape Instagram posts for comma-separated hashtags."""
    hashtags = parse_hashtags(hashtags_csv)
    if not hashtags:
        return "No hashtags provided."

    try:
        username, password = require_instagram_credentials()
    except RuntimeError as e:
        return f"Error: {e}"

    config = load_config()
    _store.target_per_hashtag = target_count

    await run_scrape(
        hashtags,
        username,
        password,
        target_count=target_count,
        config=config,
        store=_store,
    )

    msg = (
        f"Scraped {_store.total_posts} posts ({len(_store.unique_urls())} unique) "
        f"across {len(hashtags)} hashtags."
    )
    if _store.failed_hashtags:
        msg += f" Failed: {', '.join(f'#{h}' for h in _store.failed_hashtags)}"
    msg += " Call save_results() for a final summary (already auto-saved)."
    return msg


root_agent = LlmAgent(
    model=gemini_flash(),  # gemini-flash-latest
    name="instagram_scraper_agent",
    instruction=(
        "You are an Instagram scraper agent.\n"
        "1. Call scrape_all(hashtags_csv=..., target_count=N) with the user's hashtags.\n"
        "2. Call save_results() for a summary.\n"
        "Do not use browser tools manually — scrape_all handles everything."
    ),
    tools=[
        FunctionTool(func=scrape_all),
        FunctionTool(func=save_results),
    ],
)
