"""Gemini model ID aliases (always-current -latest flags)."""

from __future__ import annotations

import os

# Public alias IDs from the Gemini API (track latest flash / pro)
GEMINI_FLASH_LATEST = "gemini-flash-latest"
GEMINI_PRO_LATEST = "gemini-pro-latest"


def gemini_flash() -> str:
    """Default fast model (agent browser, ADK tools)."""
    return os.environ.get("AGENT_BROWSER_MODEL") or os.environ.get(
        "GEMINI_FLASH_MODEL", GEMINI_FLASH_LATEST
    )


def gemini_pro() -> str:
    """Default stronger model (image-grid captcha)."""
    return os.environ.get("CAPTCHA_MODEL") or os.environ.get(
        "GEMINI_PRO_MODEL", GEMINI_PRO_LATEST
    )
