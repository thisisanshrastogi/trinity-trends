#!/usr/bin/env python3
"""Download Instagram media audio via yt-dlp and transcribe with faster_whisper.

Usage:
    python3 transcribe.py <instagram_url>
    python3 transcribe.py <instagram_url> --model base --language en

Prints the transcription text to stdout. Errors go to stderr.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path


def download_audio(url: str, output_path: str) -> None:
    """Download audio from URL using yt-dlp, output as 16kHz mono WAV."""
    cmd = [
        "yt-dlp",
        "-x",
        "--audio-format", "wav",
        "--postprocessor-args", "ffmpeg:-ar 16000 -ac 1",
        "--force-overwrites",
        "--no-playlist",
        "-o", output_path,
        url,
    ]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=120,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"yt-dlp failed (code {result.returncode}): {result.stderr.strip()}"
        )
    if not Path(output_path).exists():
        raise FileNotFoundError(f"yt-dlp did not produce output file: {output_path}")


def transcribe_audio(audio_path: str, model_size: str = "base", language: str | None = None) -> str:
    """Transcribe a WAV file using faster_whisper. Returns text."""
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    
    kwargs: dict = {}
    if language:
        kwargs["language"] = language

    segments, info = model.transcribe(audio_path, **kwargs)
    
    text_parts = []
    for segment in segments:
        text_parts.append(segment.text.strip())
    
    return " ".join(text_parts)


def process_url(url: str, model_size: str = "base", language: str | None = None) -> str:
    """Download + transcribe a single URL. Returns transcript text."""
    tmp_dir = tempfile.gettempdir()
    audio_path = os.path.join(tmp_dir, f"ig_audio_{uuid.uuid4().hex}.wav")

    try:
        print(f"Downloading audio from {url}...", file=sys.stderr)
        download_audio(url, audio_path)

        print(f"Transcribing with faster_whisper ({model_size})...", file=sys.stderr)
        transcript = transcribe_audio(audio_path, model_size, language)
        return transcript
    finally:
        try:
            Path(audio_path).unlink(missing_ok=True)
        except Exception:
            pass


def process_batch(urls: list[str], model_size: str = "base", language: str | None = None) -> dict[str, str]:
    """Process multiple URLs. Returns {url: transcript} dict."""
    results: dict[str, str] = {}
    for i, url in enumerate(urls, 1):
        print(f"Processing {i}/{len(urls)}: {url}", file=sys.stderr)
        try:
            results[url] = process_url(url, model_size, language)
        except Exception as e:
            err_str = str(e)
            if "No video formats found" in err_str or "There is no video in this post" in err_str:
                print(f"Skipped {url}: Post contains no video/audio (likely a photo or carousel)", file=sys.stderr)
            else:
                print(f"Failed {url}: {err_str}", file=sys.stderr)
            results[url] = ""
    return results

def main() -> None:
    parser = argparse.ArgumentParser(description="Download and transcribe Instagram media")
    parser.add_argument("url", nargs="?", help="Single Instagram URL to transcribe")
    parser.add_argument("--model", default="base", help="Whisper model size (tiny, base, small, medium, large)")
    parser.add_argument("--language", default=None, help="Language code (e.g. en, es, hi)")
    parser.add_argument("--batch", type=str, default=None,
                        help="Path to JSON file with list of URLs to batch-process")
    parser.add_argument("--output", type=str, default=None,
                        help="Output JSON path for batch results (default: stdout)")
    args = parser.parse_args()

    if args.batch:
        urls = json.loads(Path(args.batch).read_text())
        results = process_batch(urls, args.model, args.language)
        output_json = json.dumps(results, indent=2, ensure_ascii=False)
        if args.output:
            Path(args.output).write_text(output_json, encoding="utf-8")
            print(f"[transcribe] Results saved to {args.output}", file=sys.stderr)
        else:
            print(output_json)
    elif args.url:
        transcript = process_url(args.url, args.model, args.language)
        print(transcript)
    else:
        parser.error("Provide a URL or --batch <file>")


if __name__ == "__main__":
    main()
