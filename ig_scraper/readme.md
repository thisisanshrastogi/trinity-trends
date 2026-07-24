# Instagram Agent

Scrapes Instagram **post/reel URLs** for hashtags in `config.json` using Playwright.

Default path is a **direct, deterministic scrape**. Optional Google ADK mode: `--agent`.  
Post-login CAPTCHAs are handled by a **Gemini vision agent** on the same browser.

## Quick start

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
cp .env.example .env   # fill credentials + GOOGLE_API_KEY
```

```bash
python3 main.py              # direct scrape
python3 main.py --agent      # ADK wrapper
python3 main.py -v           # debug logs
```

## Demo

# Init
First time while running the scraper It would go to instagram page, log in, solve captcha's and scrap the hashtag based post from config.json

https://github.com/user-attachments/assets/08eb3eea-bd66-45cc-873b-c369ecbdc1f6

# Re-Use
Uses session from init and directly goes to scraping, if needed re-logins

https://github.com/user-attachments/assets/66dfaeec-954e-4537-83d4-65e13fbaecf8


## Docs

| Doc | Contents |
|-----|----------|
| [docs/short-guide.md](docs/short-guide.md) | Setup, run, troubleshooting |
| [docs/overview.md](docs/overview.md) | Architecture, modules, design |

## Config

See `config.json`. Important fields: `hashtags`, `posts_per_hashtag`, `headless`,  
`agent_browser_on_challenge`, delays, optional `proxy`.

## Output

`instagram_results.json` — `{ metadata, results }` with per-hashtag URL lists.  
Checkpointed after each hashtag.

## Exit codes

`0` ok · `1` hard fail · `2` partial · `130` interrupt

## Tests

```bash
HEADLESS=1 pytest tests/ -v
```

## Layout

```
main.py  scraper.py  agent_browser.py  agent.py  results.py
constants.py  utils/  tests/  config.json  docs/
```
