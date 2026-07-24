"""Vision-based reCAPTCHA / Meta image-grid solver (Gemini).

Techniques (drawn from common open-source grid solvers + vision agents):
1. Target the captcha iframe / widget DOM, not freehand full-page coords
2. Click tiles by **index** (row-major 0..N-1), like 2captcha grid method
3. **Single container screenshot** — crop + **number-annotate** so the model
   sees clear cell IDs with full visual context (shadows, tile edges)
4. Force **structured JSON** from Gemini (selected tile list + confidence)
5. Multi-round loop (reCAPTCHA often needs 1-5 NEXT rounds)
6. **Confidence gate** — reload on low confidence instead of submitting wrong tiles
7. Per-tile second pass if the first answer looks weak (parallelized)
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import random
import re
from typing import Any

from playwright.async_api import Frame, Locator, Page

from utils.helpers import sleep_random
from utils.models import gemini_flash, gemini_pro

logger = logging.getLogger("instagram_agent.captcha_vision")

# Stronger vision model for grids (gemini-pro-latest by default)
CAPTCHA_MODEL = gemini_pro()

# Classic reCAPTCHA image-select DOM
TILE_SELECTORS = (
    "#rc-imageselect-target td",
    ".rc-imageselect-tile",
    "td.rc-imageselect-tile",
    "[class*='imageselect-tile']",
)
PROMPT_SELECTORS = (
    ".rc-imageselect-desc-wrapper",
    ".rc-imageselect-desc",
    "#rc-imageselect strong",
    ".rc-imageselect-instructions",
    "[class*='imageselect-desc']",
)
GRID_SELECTORS = (
    "#rc-imageselect-target",
    "table.rc-imageselect-table-33",
    "table.rc-imageselect-table-44",
    "table.rc-imageselect-table-42",
    ".rc-imageselect-table",
    "#rc-imageselect",
)
VERIFY_SELECTORS = (
    "#recaptcha-verify-button",
    "button#recaptcha-verify-button",
    "button:has-text('Verify')",
    "button:has-text('NEXT')",
    "button:has-text('Next')",
    "button:has-text('Skip')",
    ".rc-button-default",
)
RELOAD_SELECTORS = (
    "#recaptcha-reload-button",
    "button#recaptcha-reload-button",
    "button[title*='Get a new']",
)

SYSTEM_GRID = """You solve reCAPTCHA image-grid challenges.

You will see a screenshot of a grid. Each cell is labeled with its index number
(0-based, row-major: left→right, top→bottom).

Return ONLY valid JSON:
{
  "selected": [<int indices of cells that match the prompt>],
  "none_match": <true if zero cells match>,
  "confidence": <0.0-1.0>,
  "reason": "<brief>"
}

Rules:
- Select EVERY cell that contains the target object (even partially).
- For "motorcycles" include scooters/motorbikes; for "cars" include vans/trucks only if the prompt says so.
- Prefer recall: if unsure but object is likely present, INCLUDE the cell.
- Indices must be valid for the grid size given.
- Do not invent indices outside 0..N-1.
- If the prompt says none, set none_match true and selected [].
"""


def _api_key() -> str | None:
    return os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")


async def page_has_image_captcha(page: Page) -> bool:
    """True only if an image-grid (or checkbox) widget is still on the page.

    Do not key off bare 'recaptcha' in the URL — local fixtures / leftover
    paths would false-positive after the grid is cleared.
    """
    # Grid tiles (3x3 / 4x4)
    for root in await _frames_to_search(page):
        try:
            n = await root.locator(
                ".rc-imageselect-tile, #rc-imageselect-target td, "
                "#rc-imageselect-target .rc-imageselect-tile"
            ).count()
            if n >= 9:
                return True
        except Exception:
            continue

    # Checkbox challenge (pre-grid)
    for root in await _frames_to_search(page):
        try:
            if await root.locator(
                ".recaptcha-checkbox-border, #recaptcha-anchor, "
                ".rc-anchor-checkbox"
            ).count():
                return True
        except Exception:
            continue

    # Instagram Meta auth shell still showing challenge chrome
    url = (page.url or "").lower()
    if "instagram.com" in url and "auth_platform" in url:
        try:
            if await page.locator("#rc-imageselect, .rc-imageselect").count():
                return True
        except Exception:
            pass
    return False


async def _frames_to_search(page: Page) -> list[Page | Frame]:
    out: list[Page | Frame] = [page]
    for fr in page.frames:
        if fr == page.main_frame:
            continue
        out.append(fr)
    return out


async def _find_tile_locator(root: Page | Frame) -> Locator | None:
    for sel in TILE_SELECTORS:
        loc = root.locator(sel)
        try:
            n = await loc.count()
            if n >= 9:
                return loc
        except Exception:
            continue
    return None


async def _find_captcha_context(page: Page) -> tuple[Page | Frame, Locator] | None:
    for root in await _frames_to_search(page):
        tiles = await _find_tile_locator(root)
        if tiles is not None:
            return root, tiles
    return None


async def _challenge_prompt(root: Page | Frame) -> str:
    for sel in PROMPT_SELECTORS:
        try:
            loc = root.locator(sel).first
            if await loc.count() and await loc.is_visible(timeout=800):
                text = (await loc.inner_text()).strip()
                if text:
                    return re.sub(r"\s+", " ", text)
        except Exception:
            continue
    try:
        body = await root.locator("body").inner_text(timeout=2000)
        m = re.search(
            r"select all (?:squares|images) with\s+([^\n]+)",
            body,
            re.I,
        )
        if m:
            return m.group(0).strip()
    except Exception:
        pass
    return "Select all matching squares"


async def _grid_screenshot(root: Page | Frame, tiles: Locator) -> bytes | None:
    """Single screenshot of the grid container element (fast, preserves full visual context).

    Playwright's element-level screenshot handles iframe coordinates correctly,
    avoiding the frame-coordinate bug in the earlier bounding-box fallback.
    Falls back to tile stitching only if the container selectors don't match.
    """
    for sel in GRID_SELECTORS:
        try:
            loc = root.locator(sel).first
            if await loc.count() and await loc.is_visible(timeout=300):
                return await loc.screenshot(type="png")
        except Exception:
            continue
    # Fallback: stitch individual tiles
    try:
        n = await tiles.count()
        return await _stitch_tiles(tiles, n)
    except Exception:
        return None


async def _stitch_tiles(tiles: Locator, n: int) -> bytes | None:
    """Screenshot each tile and stitch into a grid image with indices."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        logger.warning("Pillow not installed — cannot stitch tiles")
        return None

    imgs = []
    for i in range(n):
        raw = await tiles.nth(i).screenshot(type="png")
        imgs.append(Image.open(io.BytesIO(raw)).convert("RGB"))
    if not imgs:
        return None

    cols = 4 if n == 16 else 3 if n == 9 else int(round(n ** 0.5)) or 1
    rows = (n + cols - 1) // cols
    tw, th = imgs[0].size
    canvas = Image.new("RGB", (cols * tw, rows * th), (255, 255, 255))
    draw = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    for i, im in enumerate(imgs):
        r, c = divmod(i, cols)
        x, y = c * tw, r * th
        canvas.paste(im.resize((tw, th)), (x, y))
        label = str(i)
        draw.rectangle([x + 2, y + 2, x + 22, y + 18], fill=(0, 0, 0))
        draw.text((x + 5, y + 3), label, fill=(0, 255, 255), font=font)
    buf = io.BytesIO()
    canvas.save(buf, format="PNG")
    return buf.getvalue()


def annotate_grid_image(png: bytes, n_tiles: int) -> bytes:
    """Draw 0..N-1 labels on an assumed square grid for the model."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        return png

    im = Image.open(io.BytesIO(png)).convert("RGB")
    cols = 4 if n_tiles == 16 else 3 if n_tiles == 9 else int(round(n_tiles ** 0.5)) or 1
    rows = (n_tiles + cols - 1) // cols
    cw, ch = im.width / cols, im.height / rows
    draw = ImageDraw.Draw(im)
    try:
        font = ImageFont.load_default()
    except Exception:
        font = None
    for i in range(n_tiles):
        r, c = divmod(i, cols)
        x, y = c * cw, r * ch
        bx0, by0 = x + 4, y + 4
        draw.rectangle([bx0, by0, bx0 + 28, by0 + 22], fill=(0, 0, 0))
        draw.rectangle([bx0, by0, bx0 + 28, by0 + 22], outline=(0, 255, 255), width=2)
        draw.text((bx0 + 6, by0 + 4), str(i), fill=(0, 255, 255), font=font)
        draw.rectangle([x + 1, y + 1, x + cw - 2, y + ch - 2], outline=(255, 255, 0), width=1)
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def _parse_selection(
    raw: str, n_tiles: int, confidence_threshold: float = 0.0
) -> tuple[list[int], float]:
    """Parse Gemini JSON response into (selected_indices, confidence).

    Returns:
        (selected_indices, confidence):
        - selected_indices: list of tile indices the model chose (empty if none_match or below threshold)
        - confidence: 0.0..1.0 confidence from the model
    """
    raw = raw.strip()
    if "```" in raw:
        raw = re.sub(r"```(?:json)?", "", raw).replace("```", "").strip()
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", raw)
        if not m:
            nums = [int(x) for x in re.findall(r"\b(\d{1,2})\b", raw)] if raw else []
            indices = sorted({i for i in nums if 0 <= i < n_tiles})
            return (indices, 0.5 if indices else 0.0)
        data = json.loads(m.group(0))

    confidence = float(data.get("confidence", data.get("overall_confidence", 0.5)))
    if data.get("none_match"):
        return ([], confidence)

    selected = data.get("selected") or data.get("tiles") or data.get("indices") or []
    out: list[int] = []
    for i in selected:
        try:
            v = int(i)
        except (TypeError, ValueError):
            continue
        if 0 <= v < n_tiles and v not in out:
            out.append(v)

    if confidence < confidence_threshold:
        return ([], confidence)
    return (out, confidence)


async def gemini_select_tiles(
    image_png: bytes,
    prompt: str,
    n_tiles: int,
    *,
    model: str | None = None,
    confidence_threshold: float = 0.0,
) -> tuple[list[int], float]:
    """Send numbered grid screenshot to Gemini Pro and return (selected_indices, confidence)."""
    key = _api_key()
    if not key:
        raise RuntimeError("GOOGLE_API_KEY required for captcha vision")

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=key)
    cols = 4 if n_tiles == 16 else 3 if n_tiles == 9 else int(round(n_tiles ** 0.5)) or 1
    rows = (n_tiles + cols - 1) // cols

    annotated = annotate_grid_image(image_png, n_tiles)

    user_text = (
        f"Challenge: {prompt}\n"
        f"Grid: {rows}x{cols} = {n_tiles} cells, indices 0..{n_tiles - 1} "
        f"(row-major, yellow borders, cyan number badges).\n"
        f"Select all cells that match. JSON only."
    )

    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_GRID,
        temperature=0.05,
        response_mime_type="application/json",
    )

    response = await asyncio.to_thread(
        client.models.generate_content,
        model=model or gemini_pro(),
        contents=[
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(text=user_text),
                    types.Part.from_bytes(data=annotated, mime_type="image/png"),
                ],
            )
        ],
        config=config,
    )
    text = (response.text or "").strip()
    logger.info("Captcha model (%s) response: %s", model or gemini_pro(), text[:400])
    return _parse_selection(text, n_tiles, confidence_threshold=confidence_threshold)


async def gemini_select_tiles_per_cell(
    tiles: Locator,
    prompt: str,
    n_tiles: int,
    *,
    model: str | None = None,
) -> list[int]:
    """Fallback: evaluate each tile individually using parallel Gemini Flash calls.

    Only called when the grid-level pass returns empty.
    Uses Gemini Flash (faster) because each call is a simple binary yes/no.
    """
    key = _api_key()
    if not key:
        return []

    from google import genai
    from google.genai import types

    client = genai.Client(api_key=key)
    model_name = model or gemini_flash()  # Flash is fast enough per-cell

    config = types.GenerateContentConfig(
        temperature=0.0,
        response_mime_type="application/json",
        system_instruction=(
            "You classify one reCAPTCHA cell image. "
            'Reply JSON: {"match": true|false, "confidence": 0-1}. '
            "match=true if the target object is visible even partially."
        ),
    )

    semaphore = asyncio.Semaphore(4)  # Up to 4 concurrent Gemini calls

    async def _classify_cell(i: int) -> int | None:
        async with semaphore:
            try:
                raw = await tiles.nth(i).screenshot(type="png")
            except Exception:
                return None
            try:
                response = await asyncio.to_thread(
                    client.models.generate_content,
                    model=model_name,
                    contents=[
                        types.Content(
                            role="user",
                            parts=[
                                types.Part.from_text(text=f"Target prompt: {prompt}\nDoes this cell match?"),
                                types.Part.from_bytes(data=raw, mime_type="image/png"),
                            ],
                        )
                    ],
                    config=config,
                )
                text = (response.text or "").strip()
                data = json.loads(re.sub(r"```(?:json)?|```", "", text).strip())
                if data.get("match") and float(data.get("confidence") or 0) >= 0.45:
                    logger.info("  cell %s MATCH", i)
                    return i
                else:
                    logger.info("  cell %s no", i)
                    return None
            except Exception as e:
                logger.debug("per-cell %s failed: %s", i, e)
                return None

    results = await asyncio.gather(*[_classify_cell(i) for i in range(n_tiles)])
    return [i for i in results if i is not None]


async def _already_selected(tiles: Locator, n: int) -> set[int]:
    selected: set[int] = set()
    for i in range(n):
        try:
            cls = await tiles.nth(i).get_attribute("class") or ""
            aria = await tiles.nth(i).get_attribute("aria-selected") or ""
            if "tileselected" in cls or "selected" in cls.lower() or aria == "true":
                selected.add(i)
        except Exception:
            continue
    return selected


async def _click_tile_indices(tiles: Locator, indices: list[int], already: set[int]) -> None:
    for i in indices:
        if i in already:
            continue
        try:
            tile = tiles.nth(i)
            box = await tile.bounding_box()
            if box:
                jx = box["x"] + box["width"] * random.uniform(0.35, 0.65)
                jy = box["y"] + box["height"] * random.uniform(0.35, 0.65)
                page = tile.page
                await page.mouse.move(jx, jy, steps=random.randint(5, 12))
                await sleep_random(0.05, 0.10)
                await page.mouse.click(jx, jy)
            else:
                await tile.click(timeout=3000)
            logger.info("Clicked tile %s", i)
            await sleep_random(0.15, 0.35)  # reduced from 0.25-0.55s
        except Exception as e:
            logger.warning("Failed to click tile %s: %s", i, e)


async def _click_verify(root: Page | Frame) -> bool:
    for sel in VERIFY_SELECTORS:
        try:
            btn = root.locator(sel).first
            if await btn.count() and await btn.is_visible(timeout=800):
                await btn.click(timeout=3000)
                logger.info("Clicked verify control: %s", sel)
                return True
        except Exception:
            continue
    return False


async def _click_verify_anywhere(page: Page, root: Page | Frame) -> bool:
    if await _click_verify(root):
        return True
    if root is not page and await _click_verify(page):
        return True
    for fr in page.frames:
        if await _click_verify(fr):
            return True
    return False


async def _reload_challenge(root: Page | Frame) -> None:
    for sel in RELOAD_SELECTORS:
        try:
            btn = root.locator(sel).first
            if await btn.count() and await btn.is_visible(timeout=500):
                await btn.click()
                await sleep_random(1.5, 2.5)
                return
        except Exception:
            continue


async def solve_recaptcha_grid(
    page: Page,
    *,
    max_rounds: int = 5,  # reduced from 8 — better recovery per round means fewer rounds needed
    use_per_cell_fallback: bool = True,
    model: str | None = None,
) -> bool:
    """
    Solve image-grid reCAPTCHA by tile index via Gemini vision.

    Strategy (see module docstring for details):
    - Single container screenshot → numbered grid → Gemini Pro
    - Confidence gate: low-confidence answers reload the challenge for a fresh grid
    - On error/incorrect: reload challenge instead of retrying the same wrong grid
    - Per-cell parallel Flash fallback for edge cases

    Returns True if the challenge UI is gone after attempts.
    """
    if not _api_key():
        logger.error("GOOGLE_API_KEY missing — cannot run captcha vision")
        return False

    for round_i in range(1, max_rounds + 1):
        if not await page_has_image_captcha(page):
            logger.info("No image captcha detected — treating as solved")
            return True

        ctx = await _find_captcha_context(page)
        if not ctx:
            logger.warning("Round %s: captcha page but no tiles found", round_i)
            await sleep_random(1.5, 2.5)
            # Maybe checkbox only — try clicking "I'm not a robot"
            try:
                for fr in page.frames:
                    try:
                        box = fr.locator(".recaptcha-checkbox-border, #recaptcha-anchor")
                        if await box.count():
                            await box.first.click(timeout=2000)
                            logger.info("Clicked reCAPTCHA checkbox")
                            await sleep_random(2, 4)
                            break
                    except Exception:
                        continue
            except Exception:
                pass
            continue

        root, tiles = ctx
        n = await tiles.count()
        if n < 9:
            logger.warning("Unexpected tile count: %s", n)
            await sleep_random(1, 2)
            continue

        prompt = await _challenge_prompt(root)
        logger.info("Captcha round %s/%s — %s tiles — prompt: %s", round_i, max_rounds, n, prompt)

        # Prefer single container screenshot (faster + preserves full visual context
        # like shadows, borders, and tile edges — the individual stitch loses this).
        png = await _grid_screenshot(root, tiles)
        if not png:
            png = await _stitch_tiles(tiles, n)
        if not png:
            logger.warning("Could not capture grid image")
            await sleep_random(1, 2)
            continue

        try:
            selected, confidence = await gemini_select_tiles(
                png, prompt, n, model=model, confidence_threshold=0.25
            )
        except Exception as e:
            logger.error("Gemini grid select failed: %s", e)
            selected, confidence = [], 0.0

        # --- Recovery: low confidence or empty selection ---
        if not selected:
            if confidence < 0.3 and round_i < max_rounds:
                # Model is unsure — reload for a fresh grid instead of submitting wrong tiles
                logger.info("Low confidence (%s) — reloading challenge", round(confidence, 2))
                await _reload_challenge(root)
                await sleep_random(1.0, 2.0)
                continue

            if use_per_cell_fallback:
                logger.info("Empty selection — per-cell fallback (Flash, parallel)")
                try:
                    selected = await gemini_select_tiles_per_cell(
                        tiles, prompt, n, model=model
                    )
                except Exception as e:
                    logger.warning("Per-cell fallback failed: %s", e)

        # --- Click tiles ---
        already = await _already_selected(tiles, n)
        # Deselect tiles the model says are wrong (if any were pre-selected)
        wrong = already - set(selected)
        if wrong:
            logger.info("Toggling off preselected non-matches: %s", sorted(wrong))
            await _click_tile_indices(tiles, sorted(wrong), set())

        if selected:
            logger.info("Selecting tiles (confidence %s): %s", round(confidence, 2), selected)
            await _click_tile_indices(tiles, selected, already - wrong)
        else:
            logger.info("No tiles to select — will Verify/Skip")

        # --- Verify ---
        await sleep_random(0.3, 0.7)
        if not await _click_verify_anywhere(page, root):
            logger.warning("Verify/Next button not found")
        await sleep_random(1.5, 2.5)  # reduced from 2.5-4.0s

        # --- Check success ---
        if not await page_has_image_captcha(page):
            logger.info("Image captcha cleared after round %s", round_i)
            return True

        # reCAPTCHA reported incorrect — reload for a fresh grid
        try:
            err = root.locator(
                ".rc-imageselect-incorrect-response, .rc-imageselect-error-select-more"
            )
            if await err.count() and await err.first.is_visible(timeout=500):
                logger.warning("reCAPTCHA incorrect — reloading challenge")
                await _reload_challenge(root)
                await sleep_random(1.0, 2.0)
        except Exception:
            pass

    logger.warning("Captcha not cleared after %s rounds", max_rounds)
    return not await page_has_image_captcha(page)
