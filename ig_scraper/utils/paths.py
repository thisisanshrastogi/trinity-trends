"""Project paths and Instagram base URL."""

from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STATE_FILE = ROOT / "instagram_state.json"
DEFAULT_OUTPUT = ROOT / "instagram_results.json"
DEFAULT_CONFIG = ROOT / "config.json"
BASE_URL = "https://www.instagram.com"
