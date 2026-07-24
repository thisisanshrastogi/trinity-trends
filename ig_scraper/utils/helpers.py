"""Small pure/async helpers shared across modules."""

from __future__ import annotations

import asyncio
import json
import logging
import random
from typing import Any, Awaitable, Callable, TypeVar

logger = logging.getLogger("instagram_agent.utils")

T = TypeVar("T")

IG_HOST_PREFIXES = (
    "https://www.instagram.com",
    "http://www.instagram.com",
    "https://instagram.com",
    "http://instagram.com",
)


def clean_hashtag(tag: str) -> str:
    return tag.lstrip("#").strip()


def build_keyword_search_url(keyword: str) -> str:
    import urllib.parse
    encoded = urllib.parse.quote(keyword.strip())
    return f"https://www.instagram.com/explore/search/keyword/?q={encoded}"


def parse_hashtags(raw: list[str] | str | None) -> list[str]:
    """Normalize a list or CSV of hashtags into clean unique tags (order preserved)."""
    if raw is None:
        return []
    if isinstance(raw, str):
        items = [p.strip() for p in raw.split(",")]
    else:
        items = list(raw)
    out: list[str] = []
    seen: set[str] = set()
    for item in items:
        tag = clean_hashtag(item)
        if not tag or tag in seen:
            continue
        seen.add(tag)
        out.append(tag)
    return out


def normalize_post_url(href: str | None) -> str | None:
    """Normalize an Instagram post/reel href to a canonical absolute URL."""
    if not href:
        return None
    href = href.strip()
    if not href:
        return None
    path = href.split("?")[0].split("#")[0]
    if path.startswith("http://") or path.startswith("https://"):
        for prefix in IG_HOST_PREFIXES:
            if path.startswith(prefix):
                path = path[len(prefix) :]
                break
        else:
            return None
    if not path.startswith("/"):
        path = "/" + path
    if not (path.startswith("/p/") or path.startswith("/reel/")):
        return None
    path = path.rstrip("/") + "/"
    return f"https://www.instagram.com{path}"


def denorm_coord(value: int | float, size: int) -> float:
    """Map 0–1000 model coordinate to pixel position within `size`."""
    return max(0.0, min(float(size - 1), (float(value) / 1000.0) * size))


async def sleep_random(min_sec: float, max_sec: float | None = None) -> None:
    if max_sec is None:
        max_sec = min_sec
    lo, hi = (min_sec, max_sec) if min_sec <= max_sec else (max_sec, min_sec)
    await asyncio.sleep(random.uniform(lo, hi))


async def retry_async(
    fn: Callable[[], Awaitable[T]],
    *,
    attempts: int = 3,
    base_delay: float = 3.0,
    label: str = "operation",
    retry_on: tuple[type[BaseException], ...] = (Exception,),
    reraise_as: type[BaseException] | None = None,
) -> T:
    """Run async `fn` with simple exponential-ish backoff."""
    last: BaseException | None = None
    for attempt in range(attempts):
        try:
            return await fn()
        except retry_on as e:  # type: ignore[misc]
            last = e
            if attempt >= attempts - 1:
                break
            delay = base_delay * (attempt + 1)
            logger.warning(
                "%s failed (%s/%s): %s — retry in %.0fs",
                label,
                attempt + 1,
                attempts,
                e,
                delay,
            )
            await asyncio.sleep(delay)
    assert last is not None
    if reraise_as:
        raise reraise_as(f"{label} failed after {attempts} attempts: {last}") from last
    raise last


def extract_function_calls(response: Any) -> list[tuple[str, dict[str, Any]]]:
    """Parse google-genai GenerateContent response into (name, args) pairs."""
    calls: list[tuple[str, dict[str, Any]]] = []
    try:
        for cand in getattr(response, "candidates", None) or []:
            content = getattr(cand, "content", None)
            if not content:
                continue
            for part in content.parts or []:
                fc = getattr(part, "function_call", None)
                if not fc:
                    continue
                raw_args = fc.args
                if raw_args is None:
                    args: dict[str, Any] = {}
                elif isinstance(raw_args, dict):
                    args = dict(raw_args)
                else:
                    try:
                        args = dict(raw_args)
                    except Exception:
                        args = json.loads(json.dumps(raw_args, default=str))
                calls.append((fc.name, args))
    except Exception as e:
        logger.warning("Failed to parse function calls: %s", e)
    return calls


def extract_response_text(response: Any) -> str:
    try:
        return (response.text or "").strip()
    except Exception:
        return ""


def args_dict(args: Any) -> dict[str, Any]:
    if args is None:
        return {}
    if isinstance(args, dict):
        return dict(args)
    try:
        return dict(args)
    except Exception:
        return json.loads(json.dumps(args, default=str))
