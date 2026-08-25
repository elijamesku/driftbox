#!/usr/bin/env python3
"""
Local-only video renderer.
Takes driftbox.md, builds a video_plan, then renders a simple narrated video per repo.
Requirements: python3, ffmpeg, and optionally macOS 'say' for TTS (falls back to silence if missing).

Usage:
  python scripts/render_video_local.py --owner OWNER --repo REPO

Outputs:
  ~/.kyrna/videos/<owner>/<repo>.mp4
"""

import argparse
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import List

ROOT = Path(__file__).resolve().parents[1]
PLAN_SCRIPT = ROOT / "scripts" / "generate_video_plan.py"
REPO_BASE = Path(os.environ.get("DRIFTBOX_REPO_BASE", Path.home() / ".kyrna" / "repos"))
VIDEO_BASE = Path(os.environ.get("DRIFTBOX_VIDEO_BASE", Path.home() / ".kyrna" / "videos"))


def run(cmd: List[str], cwd: Path | None = None, check: bool = True):
    res = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True)
    if check and res.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(cmd)}\nstdout: {res.stdout}\nstderr: {res.stderr}")
    return res


def ensure_plan(repo_path: Path, plan_path: Path):
    if plan_path.exists():
        return
    driftbox_md = repo_path / "driftbox.md"
    if not driftbox_md.exists():
        raise FileNotFoundError(f"driftbox.md not found at {driftbox_md}")
    cmd = [
        "python3",
        str(PLAN_SCRIPT),
        "--repo",
        str(repo_path),
        "--driftbox",
        "driftbox.md",
        "--output",
        str(plan_path),
    ]
    run(cmd)


def sanitize(text: str) -> str:
    return text.replace(":", "\\:").replace("'", "\\'").replace('"', '\\"')


def build_slide_filters(title: str, bullets: List[str]) -> str:
    # Title at y=120, bullets from y=240 downward
    filters = [
        f"drawtext=fontcolor=white:fontsize=48:text='{sanitize(title)}':x=(w-text_w)/2:y=120"
    ]
    for idx, bullet in enumerate(bullets[:5]):
        y = 240 + idx * 60
        filters.append(
            f"drawtext=fontcolor=white:fontsize=32:text='{sanitize(bullet)}':x=120:y={y}"
        )
    return ",".join(filters)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--owner", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--voice", default="Samantha", help="macOS 'say' voice; ignored if say not present")
    parser.add_argument("--per-slide-seconds", type=int, default=5)
    args = parser.parse_args()

    candidates = [
        REPO_BASE / args.owner / args.repo,
        REPO_BASE / args.repo,
        Path.cwd() / args.owner / args.repo,
        Path.cwd() / args.repo,
    ]
    repo_path = None
    for cand in candidates:
        if cand.exists():
            repo_path = cand
            break
    if repo_path is None:
        raise SystemExit(f"Repo not found. Tried: {', '.join(str(c) for c in candidates)}")

    plan_path = repo_path / ".kyrna" / "video_plan.json"
    plan_path.parent.mkdir(parents=True, exist_ok=True)
    ensure_plan(repo_path, plan_path)

    plan = json.loads(plan_path.read_text())
    slides = plan.get("slides") or []
    narration = plan.get("narration") or []

    if not slides:
        raise SystemExit("No slides available in plan; aborting.")

    video_dir = VIDEO_BASE / args.owner
    video_dir.mkdir(parents=True, exist_ok=True)
    output_path = video_dir / f"{args.repo}.mp4"

    with tempfile.TemporaryDirectory() as tmpdir_str:
        tmpdir = Path(tmpdir_str)
        segments = []
        say_available = shutil.which("say") is not None
        ffmpeg_available = shutil.which("ffmpeg") is not None
        if not ffmpeg_available:
            raise SystemExit("ffmpeg not found in PATH; install it to render video.")

        for idx, slide in enumerate(slides):
            title = slide.get("title", f"Slide {idx+1}")
            bullets = slide.get("bullets", [])
            narration_text = narration[idx] if idx < len(narration) else " "

            audio_path = tmpdir / f"audio_{idx}.wav"
            if say_available:
                aiff_path = tmpdir / f"audio_{idx}.aiff"
                run(["say", "-v", args.voice, "-o", str(aiff_path), narration_text], check=True)
                run(["ffmpeg", "-y", "-i", str(aiff_path), "-ar", "44100", "-ac", "2", str(audio_path)])
            else:
                # silent fallback matching duration
                run(
                    [
                        "ffmpeg",
                        "-y",
                        "-f",
                        "lavfi",
                        "-i",
                        f"anullsrc=r=44100:cl=stereo",
                        "-t",
                        str(args.per_slide_seconds),
                        str(audio_path),
                    ]
                )

            filters = build_slide_filters(title, bullets)
            video_path = tmpdir / f"video_{idx}.mp4"
            # base video with text
            run(
                [
                    "ffmpeg",
                    "-y",
                    "-f",
                    "lavfi",
                    "-i",
                    f"color=c=0x0b0b0b:s=1280x720:d={args.per_slide_seconds}",
                    "-vf",
                    filters,
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    str(video_path),
                ]
            )
            # mux with audio
            muxed = tmpdir / f"muxed_{idx}.mp4"
            run(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(video_path),
                    "-i",
                    str(audio_path),
                    "-c:v",
                    "libx264",
                    "-c:a",
                    "aac",
                    "-shortest",
                    str(muxed),
                ]
            )
            segments.append(muxed)

        # concat
        concat_file = tmpdir / "concat.txt"
        concat_file.write_text("".join([f"file '{seg}'\n" for seg in segments]))
        run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_file),
                "-c",
                "copy",
                str(output_path),
            ]
        )

    print(f"✅ Video written to {output_path}")


if __name__ == "__main__":
    main()

