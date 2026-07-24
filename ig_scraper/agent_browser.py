"""Gemini vision agent for post-login CAPTCHA / checkpoint handling.

Drives the existing Playwright page with click / multi_click / hold / drag tools.
No external captcha API — the model solves challenges from screenshots.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any

from playwright.async_api import Page

from utils.helpers import (
    denorm_coord,
    extract_function_calls,
    extract_response_text,
    sleep_random,
)
from utils.models import gemini_flash

logger = logging.getLogger("instagram_agent.agent_browser")

DEFAULT_MODEL = gemini_flash()  # gemini-flash-latest

SYSTEM_PROMPT = """You control a real browser page on Instagram after a login attempt.

Goal: reach a normal logged-in Instagram home/feed so scraping can continue.
You receive a screenshot each step. YOU solve captchas with tools.

Rules:
1. Dismiss cookies, "Save login info", notifications overlays.
2. Click Continue / Next / Not Now / OK when needed.
3. CAPTCHAs — solve them:
   - Checkbox: click it
   - Image grid: multi_click matching tile centers, then Verify
   - Press-and-hold: hold_at 5–10s
   - Slider: drag the handle
   - Text captcha: type_text what you read
4. need_human only for OTP or permanent block after many tries.
5. Stay on instagram.com. Call done when feed/home is usable.
6. Coords are 0–1000 (x right, y down). Prefer precise tile centers.
"""

# Compact tool schema for Gemini function calling
def _tool(name: str, desc: str, props: dict, required: list[str] | None = None) -> dict:
    schema: dict[str, Any] = {
        "name": name,
        "description": desc,
        "parameters": {"type": "object", "properties": props},
    }
    if required:
        schema["parameters"]["required"] = required
    return schema


_XY = {"x": {"type": "integer"}, "y": {"type": "integer"}, "intent": {"type": "string"}}

TOOL_DECLARATIONS = [
    _tool("click", "Left-click at 0–1000 coords.", _XY, ["x", "y"]),
    _tool(
        "multi_click",
        "Click multiple points (image-grid captcha tile centers).",
        {
            "points": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {"x": {"type": "integer"}, "y": {"type": "integer"}},
                    "required": ["x", "y"],
                },
            },
            "intent": {"type": "string"},
        },
        ["points"],
    ),
    _tool(
        "hold_at",
        "Press and hold at coords (press-and-hold captcha).",
        {**_XY, "seconds": {"type": "number"}},
        ["x", "y"],
    ),
    _tool(
        "drag",
        "Drag from start to end (slider captcha). Coords 0–1000.",
        {
            "start_x": {"type": "integer"},
            "start_y": {"type": "integer"},
            "end_x": {"type": "integer"},
            "end_y": {"type": "integer"},
            "steps": {"type": "integer"},
            "intent": {"type": "string"},
        },
        ["start_x", "start_y", "end_x", "end_y"],
    ),
    _tool(
        "type_text",
        "Type text (optional click at x,y first).",
        {
            "text": {"type": "string"},
            "x": {"type": "integer"},
            "y": {"type": "integer"},
            "press_enter": {"type": "boolean"},
            "intent": {"type": "string"},
        },
        ["text"],
    ),
    _tool("press_key", "Press a key.", {"key": {"type": "string"}, "intent": {"type": "string"}}, ["key"]),
    _tool(
        "scroll",
        "Scroll the page.",
        {
            "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
            "amount": {"type": "integer"},
            "intent": {"type": "string"},
        },
        ["direction"],
    ),
    _tool("wait", "Wait for the page to update.", {"seconds": {"type": "number"}, "intent": {"type": "string"}}),
    _tool("need_human", "Yield to human (OTP / stuck).", {"reason": {"type": "string"}}, ["reason"]),
    _tool("done", "Challenge cleared; ready to scrape.", {"reason": {"type": "string"}}, ["reason"]),
]


async def _viewport_size(page: Page) -> tuple[int, int]:
    vp = page.viewport_size
    if vp:
        return int(vp["width"]), int(vp["height"])
    box = await page.evaluate("() => ({w: window.innerWidth, h: window.innerHeight})")
    return int(box["w"]), int(box["h"])


async def _execute_action(page: Page, name: str, args: dict[str, Any]) -> str:
    width, height = await _viewport_size(page)
    logger.info("Agent action: %s %s", name, {k: v for k, v in args.items() if k != "intent"})

    def xy(ax: str = "x", ay: str = "y") -> tuple[float, float]:
        return denorm_coord(args[ax], width), denorm_coord(args[ay], height)

    if name == "click":
        x, y = xy()
        await page.mouse.click(x, y)
        return f"clicked ({x:.0f},{y:.0f})"

    if name == "multi_click":
        points = args.get("points") or []
        n = 0
        for p in points:
            try:
                await page.mouse.click(
                    denorm_coord(p["x"], width), denorm_coord(p["y"], height)
                )
                n += 1
                await asyncio.sleep(0.28)
            except Exception as e:
                logger.debug("multi_click point failed: %s", e)
        return f"multi_clicked {n}/{len(points)}"

    if name == "hold_at":
        x, y = xy()
        seconds = min(max(float(args.get("seconds") or 6), 1.0), 20.0)
        await page.mouse.move(x, y)
        await asyncio.sleep(0.15)
        await page.mouse.down()
        await asyncio.sleep(seconds)
        await page.mouse.up()
        return f"held ({x:.0f},{y:.0f}) {seconds}s"

    if name == "drag":
        sx, sy = denorm_coord(args["start_x"], width), denorm_coord(args["start_y"], height)
        ex, ey = denorm_coord(args["end_x"], width), denorm_coord(args["end_y"], height)
        steps = min(max(int(args.get("steps") or 20), 5), 60)
        await page.mouse.move(sx, sy)
        await asyncio.sleep(0.1)
        await page.mouse.down()
        await page.mouse.move(ex, ey, steps=steps)
        await asyncio.sleep(0.15)
        await page.mouse.up()
        return f"dragged ({sx:.0f},{sy:.0f})→({ex:.0f},{ey:.0f})"

    if name == "type_text":
        if "x" in args and "y" in args:
            x, y = xy()
            await page.mouse.click(x, y)
            await asyncio.sleep(0.2)
        text = str(args.get("text", ""))
        await page.keyboard.type(text, delay=50)
        if args.get("press_enter"):
            await page.keyboard.press("Enter")
        return f"typed {len(text)} chars"

    if name == "press_key":
        key = str(args.get("key", "Enter"))
        await page.keyboard.press(key)
        return f"pressed {key}"

    if name == "scroll":
        amount = int(args.get("amount") or 600)
        d = str(args.get("direction", "down"))
        dx = amount if d == "right" else -amount if d == "left" else 0
        dy = amount if d == "down" else -amount if d == "up" else 0
        await page.mouse.wheel(dx, dy)
        return f"scrolled {d}"

    if name == "wait":
        seconds = min(max(float(args.get("seconds") or 2), 0.5), 15)
        await asyncio.sleep(seconds)
        return f"waited {seconds}s"

    return f"unknown action {name}"


async def wait_for_human_clear(
    page: Page,
    *,
    is_clear,
    timeout_seconds: float = 300,
    poll_seconds: float = 3.0,
) -> bool:
    logger.warning(
        ">>> Agent could not finish CAPTCHA. Waiting up to %.0fs…", timeout_seconds
    )
    print(
        "\n" + "=" * 60
        + "\n  Agent CAPTCHA solve did not finish.\n"
        + "  Solve any remaining check in the open browser window.\n"
        + "  Scraping continues automatically when clear.\n"
        + "=" * 60 + "\n",
        flush=True,
    )
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            if await is_clear():
                logger.info("Challenge cleared by human")
                return True
        except Exception as e:
            logger.debug("clear-check error: %s", e)
        remaining = int(deadline - time.monotonic())
        if remaining % 30 < poll_seconds:
            logger.info("Still waiting… %ss left", remaining)
        await asyncio.sleep(poll_seconds)
    return False


async def run_agent_browser(
    page: Page,
    *,
    task: str | None = None,
    max_steps: int = 25,
    model: str | None = None,
    api_key: str | None = None,
) -> str:
    """Returns: done | need_human | no_api_key | error | max_steps."""
    key = api_key or os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not key:
        logger.warning("No GOOGLE_API_KEY — agent cannot solve captcha")
        return "no_api_key"

    try:
        from google import genai
        from google.genai import types
    except ImportError:
        logger.error("google-genai not installed")
        return "error"

    client = genai.Client(api_key=key)
    goal = task or (
        "Solve any Instagram CAPTCHA/challenge with browser tools, reach home feed, call done."
    )
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        tools=[types.Tool(function_declarations=TOOL_DECLARATIONS)],
        temperature=0.1,
    )
    history: list[Any] = []

    for step in range(1, max_steps + 1):
        try:
            png = await page.screenshot(type="png", full_page=False)
            url = page.url
        except Exception as e:
            logger.error("Screenshot failed: %s", e)
            return "error"

        history.append(
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(
                        text=(
                            f"Step {step}/{max_steps}. URL: {url}\nTask: {goal}\n"
                            "Inspect screenshot. Solve captcha if present, or call done if logged in."
                        )
                    ),
                    types.Part.from_bytes(data=png, mime_type="image/png"),
                ],
            )
        )

        logger.info("Agent browser step %s/%s url=%s", step, max_steps, url)
        try:
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=model or gemini_flash(),
                contents=history,
                config=config,
            )
        except Exception as e:
            logger.error("Gemini agent call failed: %s", e)
            return "error"

        text = extract_response_text(response)
        if text:
            logger.info("Agent says: %s", text[:400])

        try:
            if response.candidates and response.candidates[0].content:
                history.append(response.candidates[0].content)
        except Exception:
            pass

        calls = extract_function_calls(response)
        if not calls:
            logger.warning("Agent returned no tool calls")
            await asyncio.sleep(1)
            continue

        tool_parts: list[Any] = []
        for name, args in calls:
            if name == "done":
                logger.info("Agent done: %s", args.get("reason", ""))
                return "done"
            if name == "need_human":
                logger.warning("Agent needs human: %s", args.get("reason", ""))
                return "need_human"
            try:
                result = await _execute_action(page, name, args)
            except Exception as e:
                result = f"error: {e}"
                logger.warning("Action %s failed: %s", name, e)
            await asyncio.sleep(0.9)
            tool_parts.append(
                types.Part.from_function_response(
                    name=name, response={"result": result, "url": page.url}
                )
            )
        if tool_parts:
            history.append(types.Content(role="user", parts=tool_parts))

    logger.warning("Agent browser hit max steps (%s)", max_steps)
    return "max_steps"


async def resolve_post_login_challenge(
    page: Page,
    *,
    is_clear,
    is_challenge,
    timeout_seconds: float = 300,
    max_agent_steps: int = 25,
    use_agent: bool = True,
) -> bool:
    """Grid captcha vision → generic agent → human wait. True if page is clear."""
    if await is_clear():
        return True

    try:
        challenged = await is_challenge()
    except Exception:
        challenged = True
    if not challenged and await is_clear():
        return True

    # 1) Specialized reCAPTCHA image-grid solver (tile indices + Gemini JSON)
    try:
        from captcha_vision import page_has_image_captcha, solve_recaptcha_grid

        if await page_has_image_captcha(page):
            logger.warning(
                "Image-grid CAPTCHA detected — running tile-index Gemini solver"
            )
            ok = await solve_recaptcha_grid(page, max_rounds=8)
            await sleep_random(1.0, 2.0)
            if ok or await is_clear():
                logger.info("Grid captcha solver cleared the challenge")
                return True
            try:
                if not await is_challenge():
                    return True
            except Exception:
                pass
            logger.info("Grid solver incomplete — falling back to general agent")
    except Exception as e:
        logger.warning("Grid captcha solver error: %s", e)

    if await is_clear():
        return True

    logger.warning("Post-login challenge — general agent browser will try")

    if use_agent:
        steps = max(max_agent_steps, 20)
        status = await run_agent_browser(
            page,
            max_steps=steps,
            task=(
                "Solve the Instagram CAPTCHA/challenge with click/multi_click/hold_at/drag/type_text. "
                "Call done when main UI is usable. need_human only for OTP or permanent block."
            ),
        )
        await sleep_random(1.2, 1.8)
        if status == "done":
            if await is_clear():
                return True
            try:
                if not await is_challenge():
                    logger.info("Agent done; no challenge markers — treating as clear")
                    return True
            except Exception:
                return True
            # short second pass
            status = await run_agent_browser(
                page,
                max_steps=min(12, steps),
                task="Finish remaining captcha; call done when home/feed is clear.",
            )
            await sleep_random(1.2, 1.8)
            if await is_clear():
                return True
            try:
                if status == "done" and not await is_challenge():
                    return True
            except Exception:
                if status == "done":
                    return True
        elif status == "need_human":
            logger.info("Agent deferred to human")
        elif status == "no_api_key":
            logger.error("Set GOOGLE_API_KEY so the agent can solve captchas")
        elif status == "max_steps":
            logger.warning("Agent hit max steps without clearing captcha")
    else:
        logger.info("Agent browser disabled")

    if await is_clear():
        return True
    return await wait_for_human_clear(
        page, is_clear=is_clear, timeout_seconds=timeout_seconds
    )
