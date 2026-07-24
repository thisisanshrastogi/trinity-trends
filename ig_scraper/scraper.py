"""Playwright-based Instagram hashtag scraper."""

from __future__ import annotations

import logging
import random
from pathlib import Path
from typing import Any

from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    Playwright,
    TimeoutError as PwTimeout,
    async_playwright,
)

from constants import (
    CAPTCHA_MARKERS,
    CAPTCHA_WIDGET_SELECTOR,
    CHALLENGE_MARKERS,
    CHALLENGE_URL_PARTS,
    LOGGED_IN_SELECTORS,
    LOGIN_SUBMIT_SELECTORS,
    OVERLAY_BUTTON_TEXTS,
    PASSWORD_SELECTOR,
    SAVED_PROFILE_CONTINUE_SELECTORS,
    SAVED_PROFILE_MARKERS,
    SAVED_PROFILE_PASSWORD_MARKERS,
    STEALTH_INIT_SCRIPT,
    USER_AGENT,
    USERNAME_SELECTOR,
)
from results import ResultsStore
from utils.config import AppConfig
from utils.helpers import clean_hashtag, normalize_post_url, retry_async, sleep_random, build_keyword_search_url
from utils.paths import BASE_URL, STATE_FILE

logger = logging.getLogger("instagram_agent.scraper")


class SessionInvalidError(RuntimeError):
    """Session missing, expired, challenged, or CAPTCHA not cleared."""


class InstagramScraper:
    def __init__(
        self,
        headless: bool = False,
        proxy: dict[str, Any] | None = None,
        scroll_pause_seconds: float = 2.0,
        hashtag_delay_min: float = 4.0,
        hashtag_delay_max: float = 10.0,
        state_file: Path | str | None = None,
        agent_browser_on_challenge: bool = True,
        challenge_timeout_seconds: float = 300,
        agent_browser_max_steps: int = 25,
    ):
        self.headless = headless
        self.proxy = proxy
        self.scroll_pause_seconds = max(0.5, float(scroll_pause_seconds))
        self.hashtag_delay_min = max(0.0, float(hashtag_delay_min))
        self.hashtag_delay_max = max(self.hashtag_delay_min, float(hashtag_delay_max))
        self.state_file = Path(state_file) if state_file else STATE_FILE
        self.agent_browser_on_challenge = agent_browser_on_challenge
        self.challenge_timeout_seconds = float(challenge_timeout_seconds)
        self.agent_browser_max_steps = int(agent_browser_max_steps)

        self._pw: Playwright | None = None
        self.browser: Browser | None = None
        self.context: BrowserContext | None = None
        self.page: Page | None = None
        self._collected_urls: dict[str, list[str]] = {}
        # Set in login(); used for saved-profile password re-prompts mid-session.
        self._username: str = ""
        self._password: str = ""

    # ── lifecycle ──────────────────────────────────────────────

    def _proxy_kwargs(self) -> dict[str, Any]:
        if not self.proxy:
            return {}
        proxy = {k: v for k, v in self.proxy.items() if v}
        return {"proxy": proxy} if "server" in proxy else {}

    async def _new_context(self, *, load_state: bool) -> None:
        if not self.browser:
            raise RuntimeError("Browser not started.")
        if self.context:
            try:
                await self.context.close()
            except Exception:
                pass
            self.context = self.page = None

        storage = str(self.state_file) if load_state and self.state_file.exists() else None
        self.context = await self.browser.new_context(
            viewport={"width": 1280, "height": 800},
            user_agent=USER_AGENT,
            locale="en-US",
            timezone_id="America/New_York",
            storage_state=storage,
            **self._proxy_kwargs(),
        )
        await self.context.add_init_script(STEALTH_INIT_SCRIPT)
        self.page = await self.context.new_page()
        self.page.set_default_timeout(30000)

    async def start(self) -> None:
        self._pw = await async_playwright().start()
        self.browser = await self._pw.chromium.launch(
            headless=self.headless,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-infobars",
                "--window-size=1280,800",
            ],
        )
        await self._new_context(load_state=True)

    async def close(self) -> None:
        for closer in (
            self.context.close if self.context else None,
            self.browser.close if self.browser else None,
            self._pw.stop if self._pw else None,
        ):
            if closer is None:
                continue
            try:
                await closer()
            except Exception as e:
                logger.debug("close error: %s", e)
        self.page = self.context = self.browser = self._pw = None

    async def _save_state(self) -> None:
        if self.context:
            await self.context.storage_state(path=str(self.state_file))
            logger.info("Session state saved to %s", self.state_file.name)

    # ── page helpers ───────────────────────────────────────────

    def _require_page(self) -> Page:
        if not self.page:
            raise RuntimeError("Browser not started.")
        return self.page

    async def _navigate(self, url: str, **kwargs: Any) -> None:
        page = self._require_page()
        kwargs.setdefault("wait_until", "load")

        async def _go() -> None:
            await page.goto(url, **kwargs)

        await retry_async(
            _go,
            attempts=3,
            base_delay=3,
            label=f"navigate {url}",
            retry_on=(PwTimeout, ConnectionError, OSError),
        )

    async def _dismiss_overlays(self) -> None:
        page = self.page
        if not page:
            return
        for text in OVERLAY_BUTTON_TEXTS:
            try:
                btn = page.locator(f"button:has-text('{text}')").first
                if await btn.is_visible(timeout=800):
                    await btn.click()
                    await sleep_random(0.4, 1.2)
            except Exception:
                continue

    async def _page_text_lower(self) -> str:
        page = self.page
        if not page:
            return ""
        try:
            return (await page.inner_text("body")).lower()
        except Exception:
            return ""

    async def _debug_page(self, label: str) -> None:
        page = self.page
        if not page:
            return
        try:
            title = await page.title()
        except Exception:
            title = "?"
        text = (await self._page_text_lower())[:180].replace("\n", " ")
        logger.warning("%s — url=%s title=%r body~%r", label, page.url, title, text)

    async def _visible(self, selector: str, timeout: int = 1200) -> bool:
        page = self.page
        if not page:
            return False
        try:
            return await page.locator(selector).first.is_visible(timeout=timeout)
        except Exception:
            return False

    async def _has_login_form(self) -> bool:
        return await self._visible(USERNAME_SELECTOR, timeout=1500)

    async def _has_password_field(self) -> bool:
        return await self._visible(PASSWORD_SELECTOR, timeout=800)

    async def _is_login_url(self) -> bool:
        page = self.page
        return bool(page and "/accounts/login" in (page.url or "").lower())

    async def _looks_logged_in(self) -> bool:
        if await self._has_login_form():
            return False
        for sel in LOGGED_IN_SELECTORS:
            if await self._visible(sel):
                return True
        return False

    async def _has_continue_button(self) -> bool:
        for sel in SAVED_PROFILE_CONTINUE_SELECTORS:
            if await self._visible(sel, timeout=1000):
                return True
        return False

    async def _is_saved_profile_resume(self) -> bool:
        """True when Instagram shows saved-profile 'Continue' (not full login).

        Typical UI: avatar + username, blue Continue, 'Use another profile',
        URL often still /accounts/login/ — session cookies are already present.
        """
        if not self.page:
            return False
        # Password re-prompt modal is handled separately.
        if await self._is_saved_profile_password_prompt():
            return False
        # Full username+password form means real re-auth, not one-click resume.
        if await self._has_login_form() and await self._has_password_field():
            return False
        if not await self._has_continue_button():
            return False
        text = await self._page_text_lower()
        if any(m in text for m in SAVED_PROFILE_MARKERS):
            return True
        # Continue on login URL without a password field is enough.
        return await self._is_login_url()

    async def _is_saved_profile_password_prompt(self) -> bool:
        """Avatar + password modal (password only; username is display text).

        Distinct from classic login which has both username and password inputs.
        """
        if not self.page or not await self._has_password_field():
            return False
        # Classic form has a real username/email input — not this modal.
        if await self._has_login_form():
            return False
        text = await self._page_text_lower()
        if "forgot password" in text:
            return True
        if any(m in text for m in SAVED_PROFILE_PASSWORD_MARKERS):
            return True
        # Password-only on login URL is enough.
        return await self._is_login_url()

    async def _click_saved_profile_continue(self) -> bool:
        page = self.page
        if not page:
            return False
        for sel in SAVED_PROFILE_CONTINUE_SELECTORS:
            try:
                btn = page.locator(sel).first
                if await btn.is_visible(timeout=1500):
                    logger.info("Saved profile screen — clicking Continue")
                    await btn.click()
                    await sleep_random(2.5, 5.0)
                    return True
            except Exception:
                continue
        return False

    async def _submit_login_button(self) -> bool:
        page = self.page
        if not page:
            return False
        for sel in LOGIN_SUBMIT_SELECTORS:
            try:
                btn = page.locator(sel).first
                if await btn.is_visible(timeout=1500):
                    await btn.click()
                    return True
            except Exception:
                continue
        try:
            await page.keyboard.press("Enter")
            return True
        except Exception:
            return False

    async def _login_error_visible(self) -> bool:
        text = await self._page_text_lower()
        markers = (
            "sorry, your password was incorrect",
            "password was incorrect",
            "incorrect password",
            "wrong password",
            "please check your username",
            "don't match",
            "do not match",
            "invalid credentials",
            "there was a problem logging you into instagram",
        )
        return any(m in text for m in markers)

    async def _try_saved_profile_password(self) -> bool:
        """Fill env password into saved-profile password modal. Returns success."""
        if not await self._is_saved_profile_password_prompt():
            return False
        if not self._password:
            logger.warning("Password prompt shown but no password in memory/env")
            return False

        logger.info("Saved-profile password prompt — filling INSTAGRAM_PASSWORD")
        try:
            await self._wait_and_fill(PASSWORD_SELECTOR, self._password, timeout=10000)
        except Exception as e:
            logger.warning("Could not fill password on saved-profile prompt: %s", e)
            return False
        await sleep_random(0.3, 0.8)
        if not await self._submit_login_button():
            logger.warning("Could not submit saved-profile password form")
            return False

        await sleep_random(4, 8)
        await self._dismiss_overlays()

        if await self._login_error_visible():
            logger.warning("Saved-profile password rejected by Instagram")
            return False

        if await self._is_challenge_page():
            try:
                await self._handle_post_login_challenge()
            except SessionInvalidError:
                return False

        if await self._is_saved_profile_password_prompt():
            logger.warning("Still on password prompt after submit")
            return False
        if await self._is_saved_profile_resume():
            # Sometimes lands back on Continue; try once.
            if not await self._click_saved_profile_continue():
                return False
            await self._dismiss_overlays()
            await sleep_random(1.5, 3.0)

        if await self._looks_logged_in() or not await self._is_login_url():
            await self._save_state()
            logger.info("Saved-profile password accepted — session OK")
            return True
        if await self._has_password_field() and await self._login_error_visible():
            return False
        # Soft success if password field gone and no hard error.
        if not await self._has_password_field() and not await self._has_login_form():
            await self._save_state()
            logger.info("Saved-profile password submit cleared login fields")
            return True
        return False

    async def _clear_saved_state(self) -> None:
        try:
            if self.state_file.exists():
                self.state_file.unlink(missing_ok=True)
                logger.warning("Deleted %s (stale/bad session)", self.state_file.name)
        except OSError as e:
            logger.warning("Could not delete state file: %s", e)

    async def _restart_browser_without_session(self) -> None:
        """Drop storage_state and open a clean browser context."""
        await self._clear_saved_state()
        logger.info("Restarting browser without pre-saved session")
        await self._new_context(load_state=False)

    async def _full_credential_login(self) -> None:
        """Username+password login from env (no storage_state)."""
        if not self._username or not self._password:
            raise RuntimeError(
                "Missing credentials for full login "
                "(INSTAGRAM_USERNAME / INSTAGRAM_PASSWORD)"
            )
        page = self._require_page()
        await self._navigate(f"{BASE_URL}/accounts/login/")
        await sleep_random(3, 6)
        await self._dismiss_overlays()

        # If IG still shows saved-profile UI without state, handle those first.
        if await self._is_saved_profile_resume():
            await self._click_saved_profile_continue()
            await self._dismiss_overlays()
        if await self._is_saved_profile_password_prompt():
            if await self._try_saved_profile_password():
                return

        try:
            await self._wait_and_fill(USERNAME_SELECTOR, self._username)
        except Exception as e:
            # Password-only modal still possible.
            if await self._is_saved_profile_password_prompt():
                if await self._try_saved_profile_password():
                    return
            await self._debug_page("username field missing")
            raise RuntimeError(f"Could not find username field: {e}") from e
        await sleep_random(0.3, 0.8)

        try:
            await self._wait_and_fill(PASSWORD_SELECTOR, self._password, timeout=15000)
        except Exception as e:
            await self._debug_page("password field missing")
            raise RuntimeError(f"Could not find password field: {e}") from e
        await sleep_random(0.3, 0.8)

        if not await self._submit_login_button():
            raise RuntimeError("Could not submit login form")

        await sleep_random(5, 10)
        await self._dismiss_overlays()

        if await self._is_saved_profile_resume():
            await self._try_resume_saved_profile()
        if await self._is_saved_profile_password_prompt():
            await self._try_saved_profile_password()

        if await self._is_challenge_page() or not await self._is_ready_to_scrape():
            await self._debug_page("post-login challenge/captcha")
            await self._handle_post_login_challenge()

        still_login = await self._is_login_url() and (
            await self._has_login_form()
            or await self._has_password_field()
            or await self._is_saved_profile_resume()
        )
        if still_login and await self._login_error_visible():
            raise RuntimeError("Wrong credentials or blocked login")
        if still_login:
            await self._debug_page("still on login after submit")
            raise RuntimeError(
                "Still on login page — wrong credentials or blocked login"
            )

        await self._save_state()
        logger.info("Logged in as %s", self._username)

    async def _try_resume_saved_profile(self) -> bool:
        """Click Continue on saved-profile interstitial if present. Returns success."""
        # Password modal first (Continue may sit behind it after a prior click).
        if await self._is_saved_profile_password_prompt():
            return await self._try_saved_profile_password()

        if not await self._is_saved_profile_resume():
            return False
        if not await self._click_saved_profile_continue():
            return False
        await self._dismiss_overlays()
        await sleep_random(1.0, 2.5)

        # Continue often opens password re-prompt for the same account.
        if await self._is_saved_profile_password_prompt():
            return await self._try_saved_profile_password()

        if await self._is_challenge_page():
            try:
                await self._handle_post_login_challenge()
            except SessionInvalidError:
                return False

        # Success: left login wall, or logged-in chrome, or no longer resume UI.
        if await self._looks_logged_in():
            await self._save_state()
            logger.info("Resumed saved profile — session OK")
            return True
        if await self._has_password_field():
            # Still need password — try env fill before giving up.
            if await self._try_saved_profile_password():
                return True
            logger.warning("Continue led to password prompt — env password failed")
            return False
        if await self._is_login_url() and await self._has_login_form():
            logger.warning("Continue led to full login form — session expired")
            return False
        if await self._is_saved_profile_resume():
            logger.warning("Still on saved-profile Continue after click")
            return False
        if not await self._is_login_url():
            await self._save_state()
            logger.info("Resumed saved profile — left login URL")
            return True
        # Login URL but no credential form (loading / soft interstitial).
        await self._save_state()
        logger.info("Continue clicked — treating session as resumed")
        return True

    async def _recover_or_relogin(self, where: str) -> bool:
        """Try Continue / password fill; on failure wipe state and full re-login.

        Returns True if session is usable afterward.
        """
        await self._dismiss_overlays()

        if await self._try_resume_saved_profile():
            return True
        if await self._try_saved_profile_password():
            return True

        if await self._is_challenge_page():
            try:
                await self._handle_post_login_challenge()
                return True
            except SessionInvalidError:
                pass

        needs_relogin = (
            await self._is_login_url()
            or await self._is_saved_profile_resume()
            or await self._is_saved_profile_password_prompt()
            or (
                await self._has_login_form()
                and await self._has_password_field()
            )
        )
        if not needs_relogin:
            return await self._looks_logged_in() or not await self._is_login_url()

        if not self._username or not self._password:
            logger.error(
                "Auth required while %s but credentials unavailable", where
            )
            return False

        logger.warning(
            "Auth recovery failed while %s — clearing state and full re-login",
            where,
        )
        try:
            await self._restart_browser_without_session()
            await self._full_credential_login()
            return True
        except Exception as e:
            logger.error("Full re-login after state clear failed: %s", e)
            return False

    async def _ensure_not_logged_out(self, where: str) -> None:
        """Recover Continue / password modal; raise only if truly logged out."""
        await self._dismiss_overlays()
        if await self._try_resume_saved_profile():
            return
        if await self._try_saved_profile_password():
            return
        if await self._is_challenge_page():
            await self._handle_post_login_challenge()
            return
        if await self._is_login_url() or await self._is_saved_profile_password_prompt():
            await sleep_random(1.0, 2.0)
            if await self._recover_or_relogin(where):
                return
            raise SessionInvalidError(f"Logged out while {where}")
        text = await self._page_text_lower()
        if await self._has_login_form() and (
            "log in to instagram" in text or "create an account" in text
        ):
            if await self._recover_or_relogin(where):
                return
            raise SessionInvalidError(f"Login wall while {where}")

    async def _is_challenge_page(self) -> bool:
        page = self.page
        if not page:
            return False
        url = (page.url or "").lower()
        if any(part in url for part in CHALLENGE_URL_PARTS):
            return True
        text = await self._page_text_lower()
        if any(m in text for m in CHALLENGE_MARKERS) or any(
            m in text for m in CAPTCHA_MARKERS
        ):
            return True
        return await self._visible(CAPTCHA_WIDGET_SELECTOR, timeout=800)

    async def _is_ready_to_scrape(self) -> bool:
        if not self.page or await self._is_challenge_page():
            return False
        if await self._is_saved_profile_resume():
            return False
        if await self._is_saved_profile_password_prompt():
            return False
        if await self._is_login_url() and await self._has_login_form():
            return False
        if await self._has_password_field() and await self._is_login_url():
            return False
        if await self._has_login_form():
            text = await self._page_text_lower()
            if "log in" in text and "password" in text:
                return False
        if await self._looks_logged_in():
            return True
        return not await self._is_challenge_page() and not await self._is_login_url()

    async def _handle_post_login_challenge(self) -> None:
        if not self.page:
            return
        if await self._is_ready_to_scrape() and not await self._is_challenge_page():
            return
        if self.headless:
            logger.warning(
                "Challenge while headless=true — use headless=false to see the browser"
            )

        from agent_browser import resolve_post_login_challenge

        ok = await resolve_post_login_challenge(
            self.page,
            is_clear=self._is_ready_to_scrape,
            is_challenge=self._is_challenge_page,
            timeout_seconds=self.challenge_timeout_seconds,
            max_agent_steps=self.agent_browser_max_steps,
            use_agent=self.agent_browser_on_challenge,
        )
        if not ok:
            await self._debug_page("challenge unresolved")
            raise SessionInvalidError(
                "CAPTCHA/challenge not cleared in time. "
                "Re-run with headless=false and complete the check."
            )
        await self._dismiss_overlays()
        await self._save_state()
        logger.info("Post-login challenge resolved — session saved")

    # ── session / login ────────────────────────────────────────

    async def validate_session(self) -> bool:
        """Soft check: only reject clear login walls / challenges."""
        try:
            await self._navigate(f"{BASE_URL}/")
            await sleep_random(2, 4)
            await self._dismiss_overlays()
        except Exception as e:
            logger.warning("Session validation navigation failed: %s", e)
            return False

        # Continue and/or env password on saved-profile re-prompt.
        if await self._try_resume_saved_profile():
            return True
        if await self._try_saved_profile_password():
            return True

        if await self._is_challenge_page():
            logger.warning("Challenge during session check")
            return False
        if await self._is_login_url() or (
            await self._has_login_form() and await self._has_password_field()
        ):
            logger.info("Login form present — session expired")
            return False
        if await self._looks_logged_in():
            logger.info("Logged-in UI signals found")
            return True
        logger.info("No login wall (url=%s) — trusting saved session", self.page.url)
        return True

    async def _wait_and_fill(self, selector: str, value: str, timeout: int = 25000) -> None:
        page = self._require_page()
        await page.wait_for_selector(selector, state="visible", timeout=timeout)
        await page.fill(selector, value)

    async def login(self, username: str, password: str) -> None:
        self._username = username
        self._password = password
        self._require_page()

        if self.state_file.exists():
            logger.info("Found saved session — validating...")
            if await self.validate_session():
                logger.info("Using saved session — skipping login")
                try:
                    await self._save_state()
                except Exception:
                    pass
                return
            logger.warning("Saved session invalid — clearing state and logging in again")
            await self._restart_browser_without_session()

        last_error: Exception | None = None
        for attempt in range(3):
            try:
                if attempt > 0:
                    await self._restart_browser_without_session()
                await self._full_credential_login()
                return
            except SessionInvalidError:
                raise
            except Exception as e:
                last_error = e
                if attempt < 2:
                    logger.warning(
                        "Login attempt %s failed: %s. Retrying with clean session...",
                        attempt + 1,
                        e,
                    )
                    await sleep_random(5 * (attempt + 1), 5 * (attempt + 1) + 1)
        raise RuntimeError(f"Login failed after 3 attempts: {last_error}")

    # ── scrape ─────────────────────────────────────────────────

    async def _auth_blocked_on_page(self) -> bool:
        """True if current page is login / Continue / password re-prompt."""
        if await self._is_saved_profile_resume():
            return True
        if await self._is_saved_profile_password_prompt():
            return True
        if await self._is_login_url():
            return True
        if await self._has_login_form() and await self._has_password_field():
            return True
        return False

    async def search_hashtag(self, hashtag: str) -> None:
        tag = clean_hashtag(hashtag)
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                await self._navigate(f"{BASE_URL}/explore/tags/{tag}/")
                await sleep_random(3, 8)
                await self._dismiss_overlays()

                # Continue / password modal / full login wall.
                if await self._auth_blocked_on_page():
                    logger.info(
                        "Auth interstitial while opening #%s — recovering", tag
                    )
                    if not await self._recover_or_relogin(f"opening #{tag}"):
                        raise SessionInvalidError(
                            f"Logged out while opening #{tag}"
                        )
                    # Recovery usually lands on home — re-open the tag.
                    await self._navigate(f"{BASE_URL}/explore/tags/{tag}/")
                    await sleep_random(3, 8)
                    await self._dismiss_overlays()
                    if await self._auth_blocked_on_page():
                        if not await self._recover_or_relogin(
                            f"re-opening #{tag}"
                        ):
                            raise SessionInvalidError(
                                f"Logged out while opening #{tag}"
                            )
                        await self._navigate(f"{BASE_URL}/explore/tags/{tag}/")
                        await sleep_random(3, 8)
                        await self._dismiss_overlays()

                if await self._is_challenge_page():
                    raise SessionInvalidError(
                        f"Challenge while opening #{tag} (url={self.page.url})"
                    )
                if await self._auth_blocked_on_page():
                    raise SessionInvalidError(f"Logged out while opening #{tag}")

                logger.info("Navigated to tag: #%s", tag)
                return
            except SessionInvalidError:
                raise
            except Exception as e:
                last_error = e
                if attempt < 2:
                    logger.warning("#%s nav failed: %s — retry", tag, e)
                    await sleep_random(3 * (attempt + 1), 3 * (attempt + 1) + 1)
        raise RuntimeError(f"Failed to navigate to #{tag}: {last_error}")

    async def search_keyword(self, keyword: str) -> None:
        kw = keyword.strip()
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                url = build_keyword_search_url(kw)
                await self._navigate(url)
                await sleep_random(3, 8)
                await self._dismiss_overlays()

                # Continue / password modal / full login wall.
                if await self._auth_blocked_on_page():
                    logger.info(
                        "Auth interstitial while opening search for %s — recovering", kw
                    )
                    if not await self._recover_or_relogin(f"opening search {kw}"):
                        raise SessionInvalidError(
                            f"Logged out while opening search {kw}"
                        )
                    # Recovery usually lands on home — re-open the search.
                    await self._navigate(url)
                    await sleep_random(3, 8)
                    await self._dismiss_overlays()
                    if await self._auth_blocked_on_page():
                        if not await self._recover_or_relogin(
                            f"re-opening search {kw}"
                        ):
                            raise SessionInvalidError(
                                f"Logged out while opening search {kw}"
                            )
                        await self._navigate(url)
                        await sleep_random(3, 8)
                        await self._dismiss_overlays()

                if await self._is_challenge_page():
                    raise SessionInvalidError(
                        f"Challenge while opening search {kw} (url={self.page.url})"
                    )
                if await self._auth_blocked_on_page():
                    raise SessionInvalidError(f"Logged out while opening search {kw}")

                logger.info("Navigated to search: %s", kw)
                return
            except SessionInvalidError:
                raise
            except Exception as e:
                last_error = e
                if attempt < 2:
                    logger.warning("Search %s nav failed: %s — retry", kw, e)
                    await sleep_random(3 * (attempt + 1), 3 * (attempt + 1) + 1)
        raise RuntimeError(f"Failed to navigate to search {kw}: {last_error}")

    async def _extract_post_urls(self) -> list[str]:
        page = self.page
        if not page:
            return []
        try:
            # Try to grab posts that have a video/reel icon, otherwise fallback to all posts
            links = await page.eval_on_selector_all(
                "a[href*='/p/'], a[href*='/reel/']",
                """els => {
                    const reels = els.filter(el => el.querySelector('svg[aria-label="Reel"], svg[aria-label="Clip"], svg[aria-label="Video"]'));
                    // If we found explicitly marked reels, return them. Otherwise return all of them to be safe.
                    const targets = reels.length > 0 ? reels : els;
                    return targets.map(el => el.getAttribute('href'));
                }"""
            )
        except Exception as e:
            logger.warning("URL extraction failed: %s", e)
            return []

        ordered: list[str] = []
        seen: set[str] = set()
        for link in links or []:
            full = normalize_post_url(link)
            if full and full not in seen:
                seen.add(full)
                ordered.append(full)
        return ordered

    async def _human_scroll(self) -> None:
        page = self._require_page()
        try:
            for _ in range(random.randint(2, 4)):
                await page.mouse.wheel(0, random.randint(700, 1400))
                await sleep_random(0.25, 0.7)
            if random.random() < 0.35:
                await page.evaluate(
                    "window.scrollBy(0, Math.floor(document.body.scrollHeight * 0.35))"
                )
        except Exception:
            await page.evaluate("window.scrollBy(0, document.body.scrollHeight)")

    async def scroll_and_collect(self, target_count: int = 200) -> list[str]:
        urls: list[str] = []
        seen: set[str] = set()
        stale = 0

        for full in await self._extract_post_urls():
            if full not in seen:
                seen.add(full)
                urls.append(full)

        while len(urls) < target_count:
            try:
                await self._human_scroll()
                await sleep_random(
                    self.scroll_pause_seconds * 0.8,
                    self.scroll_pause_seconds * 2.5,
                )
            except Exception as e:
                logger.warning("Scroll failed: %s", e)
                await sleep_random(2, 5)
                continue

            if await self._is_challenge_page() or await self._is_login_url():
                try:
                    await self._ensure_not_logged_out("scrolling hashtag")
                except SessionInvalidError:
                    raise SessionInvalidError(
                        f"Blocked or logged out during scroll (url={self.page.url})"
                    )
                # Resumed — keep scrolling on current page if still on tag.
                continue

            before = len(urls)
            for full in await self._extract_post_urls():
                if full not in seen:
                    seen.add(full)
                    urls.append(full)
                    if len(urls) >= target_count:
                        break

            logger.info("  Collected %s/%s post URLs", len(urls), target_count)
            stale = stale + 1 if len(urls) == before else 0
            if stale >= 6:
                logger.info("  No new posts after retries. Stopping scroll.")
                break

        return urls[:target_count]

    async def collect_for_hashtag(
        self, hashtag: str, target_count: int = 200
    ) -> list[str]:
        tag = clean_hashtag(hashtag)
        logger.info("--- Processing hashtag: #%s ---", tag)
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                await self.search_hashtag(tag)
                urls = await self.scroll_and_collect(target_count)
                self._collected_urls[tag] = urls
                logger.info("Collected %s URLs for #%s", len(urls), tag)
                return urls
            except SessionInvalidError:
                raise
            except Exception as e:
                last_error = e
                if attempt < 2:
                    logger.warning("#%s attempt %s failed: %s", tag, attempt + 1, e)
                    await sleep_random(3 * (attempt + 1), 3 * (attempt + 1) + 1)
        logger.error("#%s failed: %s", tag, last_error)
        return []

    async def collect_for_keyword(
        self, keyword: str, target_count: int = 100
    ) -> list[str]:
        kw = keyword.strip()
        logger.info("--- Processing keyword: %s ---", kw)
        last_error: Exception | None = None
        for attempt in range(3):
            try:
                await self.search_keyword(kw)
                urls = await self.scroll_and_collect(target_count)
                self._collected_urls[kw] = urls
                logger.info("Collected %s URLs for keyword %s", len(urls), kw)
                return urls
            except SessionInvalidError:
                raise
            except Exception as e:
                last_error = e
                if attempt < 2:
                    logger.warning("Keyword %s attempt %s failed: %s", kw, attempt + 1, e)
                    await sleep_random(3 * (attempt + 1), 3 * (attempt + 1) + 1)
        logger.error("Keyword %s failed: %s", kw, last_error)
        return []
    async def delay_between_hashtags(self) -> None:
        if self.hashtag_delay_max <= 0:
            return
        delay = random.uniform(self.hashtag_delay_min, self.hashtag_delay_max)
        logger.info("Waiting %.1fs before next hashtag...", delay)
        await sleep_random(delay, delay)


async def run_scrape(
    queries: list[str],
    username: str,
    password: str,
    *,
    search_type: str = "hashtag",
    target_count: int = 200,
    config: AppConfig | None = None,
    output_path: str | Path | None = None,
    store: ResultsStore | None = None,
    **scraper_overrides: Any,
) -> ResultsStore:
    """Run a multi-query scrape. Prefer passing `config=AppConfig`."""
    kwargs = config.scraper_kwargs() if config else {}
    kwargs.update(scraper_overrides)

    results = store or ResultsStore(
        output_path=output_path,
        target_per_hashtag=target_count,
    )
    results.target_per_hashtag = target_count

    scraper = InstagramScraper(**kwargs)
    await scraper.start()
    try:
        await scraper.login(username, password)
        for i, q in enumerate(queries):
            query = clean_hashtag(q) if search_type == "hashtag" else q.strip()
            if not query:
                continue
            if i > 0:
                await scraper.delay_between_hashtags()
            try:
                if search_type == "keyword":
                    urls = await scraper.collect_for_keyword(query, target_count)
                else:
                    urls = await scraper.collect_for_hashtag(query, target_count)
                
                if urls:
                    logger.info("Stored %s new URLs for %s", results.store(query, urls), query)
                else:
                    results.mark_failed(query)
                    logger.warning("No URLs for %s", query)
            except SessionInvalidError as e:
                logger.error("Session error on %s: %s", query, e)
                results.mark_failed(query)
                for rest in queries[i + 1 :]:
                    results.mark_failed(rest)
                break
            except Exception as e:
                logger.error("Skipping %s: %s", query, e)
                results.mark_failed(query)
            results.save()
    finally:
        await scraper.close()

    results.save()
    return results
