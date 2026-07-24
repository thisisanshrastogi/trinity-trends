"""Instagram DOM selectors and detection markers."""

USERNAME_SELECTOR = (
    "input[name='username'], "
    "input[name='email'], "
    "input[autocomplete='username'], "
    "input[aria-label*='username' i], "
    "input[aria-label*='email' i], "
    "input[aria-label*='Phone number' i], "
    "input[type='text']:not([type='submit'])"
)

PASSWORD_SELECTOR = (
    "input[name='password'], "
    "input[name='pass'], "
    "input[aria-label*='Password' i], "
    "input[type='password']"
)

LOGIN_SUBMIT_SELECTORS = (
    'button[type="submit"]',
    'div[role="button"]:has-text("Log in")',
    'button:has-text("Log in")',
    'button:has-text("Log In")',
)

LOGGED_IN_SELECTORS = (
    'svg[aria-label="Home"]',
    'svg[aria-label="Search"]',
    'svg[aria-label="New post"]',
    'a[href="/direct/inbox/"]',
    'a[href*="/direct/inbox"]',
    'nav[role="navigation"]',
    "nav",
)

OVERLAY_BUTTON_TEXTS = (
    "Allow essential and optional",
    "Allow all cookies",
    "Allow all",
    "Accept All",
    "Accept cookies",
    "Accept",
    "Decline optional",
    "Decline",
    "Only allow essential",
    "Not Now",
    "Not now",
    "Save Info",
    "Save info",
    "Turn on Notifications",
    "Turn on",
)

# Instagram "Continue as <user>" / saved-profile picker (storage_state present,
# but browser needs one click to resume). Not a full username/password login.
SAVED_PROFILE_CONTINUE_SELECTORS = (
    'button:has-text("Continue")',
    'div[role="button"]:has-text("Continue")',
    'button[type="button"]:has-text("Continue")',
)

SAVED_PROFILE_MARKERS = (
    "use another profile",
    "continue as",
    "create new account",
)

# Password re-prompt on saved profile (avatar + password only, no username field).
SAVED_PROFILE_PASSWORD_MARKERS = (
    "forgot password",
    "log in",
)

CHALLENGE_URL_PARTS = (
    "/challenge/",
    "/auth_platform",
    "checkpoint",
    "/captcha",
    "recaptcha",
    "auth_platform/recaptcha",
)

CHALLENGE_MARKERS = (
    "suspicious login",
    "unusual login",
    "confirm it's you",
    "confirm it\u2019s you",
    "we detected an unusual",
    "enter the code we sent",
    "security code",
    "checkpoint",
)

CAPTCHA_MARKERS = (
    "captcha",
    "recaptcha",
    "i'm not a robot",
    "i am not a robot",
    "not a robot",
    "confirm you're human",
    "confirm you are human",
    "verify you are human",
    "security check",
    "suspicious activity from",
    "challenge-platform",
    "press and hold",
)

CAPTCHA_WIDGET_SELECTOR = (
    "iframe[src*='recaptcha'], iframe[title*='captcha' i], "
    "iframe[src*='captcha'], div[class*='captcha' i]"
)

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/125.0.0.0 Safari/537.36"
)

STEALTH_INIT_SCRIPT = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
"""
