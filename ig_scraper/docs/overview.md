# Instagram Agent — Project Overview

## What this is

A small Python tool that collects **Instagram post/reel URLs** for a list of hashtags. It logs in with Playwright, scrolls hashtag explore pages, and writes a structured JSON file.

When Instagram shows a **CAPTCHA or security checkpoint** after login, a **Gemini vision agent** drives the same browser (click, multi-select tiles, press-and-hold, drag) to try to clear it. If that fails, you can finish the challenge in the open window and the scrape continues.

## Goals

| Goal | Approach |
|------|----------|
| Reliable batch scrapes | **Direct mode** (default) — no LLM in the main path |
| Optional chat-style control | `--agent` with Google ADK |
| Survive login walls | Session file + soft validation + re-login |
| Survive CAPTCHAs | Vision agent on the live Playwright page |
| Reusable config | Single `config.json` + typed `AppConfig` |

## High-level flow

```
config.json + .env
       │
       ▼
   main.py  ──default──►  run_scrape()
       │                      │
       │                      ├─ Playwright login / session
       │                      ├─ CAPTCHA? → agent_browser
       │                      ├─ for each hashtag: scroll + collect URLs
       │                      └─ ResultsStore → instagram_results.json
       │
       └── --agent ──►  ADK LlmAgent → tools scrape_all / save_results
                              (same run_scrape underneath)
```

## Module map

| Path | Role |
|------|------|
| `main.py` | CLI entry (direct / `--agent`) |
| `scraper.py` | Playwright browser, login, scroll, collect |
| `agent_browser.py` | Gemini vision agent for challenges |
| `agent.py` | Optional ADK wrapper tools |
| `results.py` | Unified results schema + dedupe |
| `constants.py` | Selectors and detection markers |
| `utils/` | Config, paths, delays, URL helpers, logging |
| `config.json` | Hashtags and scrape settings |
| `.env` | Credentials + `GOOGLE_API_KEY` |

## Output schema

```json
{
  "metadata": {
    "scraped_at": "…",
    "total_hashtags": 6,
    "total_posts": 180,
    "unique_posts": 150,
    "posts_per_hashtag_target": 200,
    "failed_hashtags": []
  },
  "results": {
    "personalfinance": ["https://www.instagram.com/p/…/", "…"]
  }
}
```

Progress is checkpointed **after each hashtag**.

## Exit codes

| Code | Meaning |
|------|---------|
| `0` | Full success |
| `1` | Hard failure (auth, zero posts) |
| `2` | Partial success (some hashtags failed) |
| `130` | Interrupted (Ctrl+C) |

## Design choices

1. **Direct scrape is primary** — easy to run/schedule locally, cheaper, fewer failure modes.
2. **Shared `run_scrape`** — ADK tools and CLI use one path.
3. **Soft session validation** — only re-login when a login form/challenge is proven; missing nav icons alone is not enough (common in automation).
4. **Agent CAPTCHA, not paid solvers** — specialized **grid solver** (tile indices + numbered overlay + Gemini JSON) for reCAPTCHA image challenges; general vision agent for other UI; human fallback if stuck.
5. **Utilities live in `utils/`** — config loading, hashtag/URL normalization, retries, logging, Gemini response parsing.

## Limits & ethics

- Instagram actively blocks automation; accounts can be challenged or restricted.
- Use only with accounts you control, at moderate volume, and in line with Instagram’s terms and local law.
- CAPTCHA vision solve is best-effort; hard challenges may still need a human.

## Related docs

- [Short guide](./short-guide.md) — setup and daily use
- Root [readme.md](../readme.md) — quick start and config table
