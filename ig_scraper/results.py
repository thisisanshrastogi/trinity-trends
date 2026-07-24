"""Unified results store for Instagram scrape output."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from utils.helpers import clean_hashtag, normalize_post_url
from utils.paths import DEFAULT_OUTPUT


class ResultsStore:
    """In-memory store with consistent on-disk schema and dedupe helpers."""

    def __init__(
        self,
        output_path: str | Path | None = None,
        target_per_hashtag: int | None = None,
    ):
        self.output_path = Path(output_path) if output_path else DEFAULT_OUTPUT
        self.target_per_hashtag = target_per_hashtag
        self._by_hashtag: dict[str, list[str]] = {}
        self.failed_hashtags: list[str] = []
        self._scraped_at: str | None = None

    def store(self, hashtag: str, urls: list[str]) -> int:
        """Merge URLs for a hashtag (per-tag dedupe). Returns newly added count."""
        tag = clean_hashtag(hashtag)
        existing = self._by_hashtag.get(tag, [])
        seen = set(existing)
        added = 0
        for raw in urls:
            url = normalize_post_url(raw)
            if not url or url in seen:
                continue
            seen.add(url)
            existing.append(url)
            added += 1
        self._by_hashtag[tag] = existing
        return added

    def mark_failed(self, hashtag: str) -> None:
        tag = clean_hashtag(hashtag)
        if tag and tag not in self.failed_hashtags:
            self.failed_hashtags.append(tag)

    def unique_urls(self) -> set[str]:
        out: set[str] = set()
        for urls in self._by_hashtag.values():
            out.update(urls)
        return out

    @property
    def total_posts(self) -> int:
        return sum(len(v) for v in self._by_hashtag.values())

    @property
    def hashtag_count(self) -> int:
        return len(self._by_hashtag)

    def to_dict(self) -> dict:
        scraped_at = self._scraped_at or datetime.now(timezone.utc).isoformat()
        return {
            "metadata": {
                "scraped_at": scraped_at,
                "total_hashtags": self.hashtag_count,
                "total_posts": self.total_posts,
                "unique_posts": len(self.unique_urls()),
                "posts_per_hashtag_target": self.target_per_hashtag,
                "failed_hashtags": list(self.failed_hashtags),
            },
            "results": {k: list(v) for k, v in self._by_hashtag.items()},
        }

    def save(self) -> Path:
        self._scraped_at = datetime.now(timezone.utc).isoformat()
        self.output_path.parent.mkdir(parents=True, exist_ok=True)
        self.output_path.write_text(
            json.dumps(self.to_dict(), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        return self.output_path

    def summary(self) -> str:
        lines = [f"  #{tag}: {len(urls)} posts" for tag, urls in self._by_hashtag.items()]
        if self.failed_hashtags:
            lines.append("  failed: " + ", ".join(f"#{h}" for h in self.failed_hashtags))
        return (
            f"Saved {self.total_posts} total posts "
            f"({len(self.unique_urls())} unique) across {self.hashtag_count} hashtags "
            f"to {self.output_path}\n" + "\n".join(lines)
        )

    def get_results(self) -> dict[str, list[str]]:
        return {k: list(v) for k, v in self._by_hashtag.items()}
