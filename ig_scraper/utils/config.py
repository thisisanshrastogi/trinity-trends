"""Load and normalize config.json into a typed settings object."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from utils.helpers import parse_hashtags
from utils.paths import DEFAULT_CONFIG


@dataclass
class AppConfig:
    hashtags: list[str] = field(default_factory=list)
    posts_per_hashtag: int = 200
    headless: bool = False
    scroll_pause_seconds: float = 2.0
    hashtag_delay_min_seconds: float = 4.0
    hashtag_delay_max_seconds: float = 10.0
    agent_browser_on_challenge: bool = True
    challenge_timeout_seconds: float = 300.0
    agent_browser_max_steps: int = 25
    proxy: dict[str, Any] | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> AppConfig:
        delay_min = float(data.get("hashtag_delay_min_seconds", 4))
        delay_max = float(data.get("hashtag_delay_max_seconds", 10))
        if delay_max < delay_min:
            delay_max = delay_min
        return cls(
            hashtags=parse_hashtags(data.get("hashtags", [])),
            posts_per_hashtag=int(data.get("posts_per_hashtag", 200)),
            headless=bool(data.get("headless", False)),
            scroll_pause_seconds=float(data.get("scroll_pause_seconds", 2)),
            hashtag_delay_min_seconds=delay_min,
            hashtag_delay_max_seconds=delay_max,
            agent_browser_on_challenge=bool(
                data.get("agent_browser_on_challenge", True)
            ),
            challenge_timeout_seconds=float(
                data.get("challenge_timeout_seconds", 300)
            ),
            agent_browser_max_steps=int(data.get("agent_browser_max_steps", 25)),
            proxy=data.get("proxy"),
        )

    def scraper_kwargs(self) -> dict[str, Any]:
        """Keyword args for InstagramScraper / run_scrape."""
        return {
            "headless": self.headless,
            "proxy": self.proxy,
            "scroll_pause_seconds": self.scroll_pause_seconds,
            "hashtag_delay_min": self.hashtag_delay_min_seconds,
            "hashtag_delay_max": self.hashtag_delay_max_seconds,
            "agent_browser_on_challenge": self.agent_browser_on_challenge,
            "challenge_timeout_seconds": self.challenge_timeout_seconds,
            "agent_browser_max_steps": self.agent_browser_max_steps,
        }


def _env_bool(name: str) -> bool | None:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return None
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str) -> int | None:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _env_float(name: str) -> float | None:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def apply_env_overrides(config: AppConfig) -> AppConfig:
    """Overlay runtime env vars (e.g. HEADLESS=1, POSTS_PER_HASHTAG)."""
    if (v := _env_bool("HEADLESS")) is not None:
        config.headless = v
    # Common alias used in CI
    if (v := _env_bool("INSTAGRAM_HEADLESS")) is not None:
        config.headless = v

    if (v := _env_int("POSTS_PER_HASHTAG")) is not None:
        config.posts_per_hashtag = v
    if (v := _env_bool("AGENT_BROWSER_ON_CHALLENGE")) is not None:
        config.agent_browser_on_challenge = v
    if (v := _env_float("CHALLENGE_TIMEOUT_SECONDS")) is not None:
        config.challenge_timeout_seconds = v
    if (v := _env_int("AGENT_BROWSER_MAX_STEPS")) is not None:
        config.agent_browser_max_steps = v
    if (v := _env_float("SCROLL_PAUSE_SECONDS")) is not None:
        config.scroll_pause_seconds = v

    # Optional hashtag override: HASHTAGS=money,creditcard
    raw_tags = os.environ.get("HASHTAGS", "").strip()
    if raw_tags:
        config.hashtags = parse_hashtags(raw_tags)

    return config


def load_config(path: str | Path | None = None) -> AppConfig:
    config_path = Path(path) if path else DEFAULT_CONFIG
    data = json.loads(config_path.read_text(encoding="utf-8"))
    return apply_env_overrides(AppConfig.from_dict(data))


def instagram_credentials() -> tuple[str, str]:
    """Return (username, password) from env."""
    return (
        os.environ.get("INSTAGRAM_USERNAME", "").strip(),
        os.environ.get("INSTAGRAM_PASSWORD", "").strip(),
    )


def require_instagram_credentials() -> tuple[str, str]:
    user, password = instagram_credentials()
    if not user or not password:
        raise RuntimeError(
            "INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD must be set in .env"
        )
    return user, password
