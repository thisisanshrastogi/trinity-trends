# Short guide

## Setup (once)

```bash
cd instagram-agent
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cp .env.example .env
```

Edit `.env`:

```
INSTAGRAM_USERNAME=…
INSTAGRAM_PASSWORD=…
GOOGLE_API_KEY=…          # agent browser CAPTCHA + optional --agent
```

Edit `config.json` hashtags / `posts_per_hashtag` / `headless` as needed.

## Run

```bash
# Recommended — deterministic Playwright scrape
python3 main.py

# Optional ADK agent
python3 main.py --agent

# Debug
python3 main.py -v

# Custom paths
python3 main.py --config config.json --output out.json
```

Use **`headless: false`** when you expect CAPTCHAs so you can watch (or finish) them.

## Session tips

- First good login writes `instagram_state.json` (gitignored).
- Later runs reuse it when still valid.
- Delete that file to force a fresh login.
- After a CAPTCHA is cleared, state is saved again so the next run is smoother.

## CAPTCHA behavior

Your screenshot case (“Select all squares with **motorcycles**” on
`auth_platform/recaptcha`) is a classic **reCAPTCHA image grid**.

Solver order:

1. **Grid vision solver** (`captcha_vision.py`) — best for this:
   - finds tiles in the reCAPTCHA iframe/DOM
   - stitches + **numbers** each cell (0…N−1)
   - Gemini returns JSON tile indices (not freehand page coords)
   - clicks those cells, presses **NEXT/Verify**, repeats rounds
   - per-cell fallback if the whole-grid answer is empty
2. **General agent browser** — hold/slider/checkbox/misc UI
3. **You** — browser stays open if still stuck (OTP / hard challenges)

Requires `GOOGLE_API_KEY`. Defaults use always-current aliases:

| Use | Default |
|-----|---------|
| Agent browser / ADK | `gemini-flash-latest` |
| Image-grid captcha | `gemini-pro-latest` |

```bash
# .env
GOOGLE_API_KEY=...
# GEMINI_FLASH_MODEL=gemini-flash-latest
# GEMINI_PRO_MODEL=gemini-pro-latest
# CAPTCHA_MODEL=gemini-pro-latest   # override captcha only
```

## Config (essentials)

| Field | Typical value |
|-------|----------------|
| `hashtags` | `["personalfinance", "money"]` |
| `posts_per_hashtag` | `200` |
| `headless` | `false` for login/CAPTCHA, `true` only if session is solid |
| `agent_browser_on_challenge` | `true` |
| `agent_browser_max_steps` | `25` |
| `proxy` | `null` or `{ "server": "http://…" }` |

## Results

Default file: `instagram_results.json`  
See [overview.md](./overview.md) for the full schema.

## Troubleshooting

| Symptom | Try |
|---------|-----|
| Username field not found | `headless: false`, delete `instagram_state.json`, watch cookie banners |
| CAPTCHA loops | Ensure `GOOGLE_API_KEY`, stay headed, solve once manually if needed |
| Zero posts | Tag may be empty/restricted; check login wall mid-run |
| Partial hashtags | Exit code `2`; re-run — failed tags are listed in metadata |

## Project layout (quick)

```
main.py            CLI
scraper.py         Browser scrape
agent_browser.py   CAPTCHA vision agent
agent.py           Optional ADK tools
results.py         JSON store
constants.py       Selectors / markers
utils/             Shared config & helpers
tests/             Unit + headless fixture tests
docs/              This documentation
```

## Tests

```bash
pip install -r requirements.txt
playwright install chromium
HEADLESS=1 pytest tests/ -v
```

Optional env overrides (local or any scheduler):

```bash
HEADLESS=1
POSTS_PER_HASHTAG=10
HASHTAGS=money,creditcard          # optional
AGENT_BROWSER_ON_CHALLENGE=1
CHALLENGE_TIMEOUT_SECONDS=90
```
