#!/usr/bin/env python3
"""
Generate a storyboard/voiceover plan for an auto-generated repo video
using existing driftbox.md content. This runs locally in a workspace only
and does not call external services. Output is a JSON plan you can feed
into a TTS + ffmpeg step of your choice.

Example:
  python scripts/generate_video_plan.py --repo . --output video_plan.json

Inputs:
  - driftbox.md (required): The source of truth for repo overview/architecture.
  - Optional diagram: pass --diagram path/to/diagram.png to include in plan metadata.

Outputs:
  - video_plan.json: slides + narration text to render externally.
"""

import argparse
import json
import re
from pathlib import Path
from typing import Dict, List, Tuple


SECTIONS_ORDER = [
    "overview",
    "architecture",
    "deployment",
    "cost",
    "security",
    "troubleshooting",
    "customization",
]


def parse_markdown_sections(md_text: str) -> Dict[str, str]:
    """
    Very small parser to grab major sections from driftbox.md by heading labels.
    """
    sections: Dict[str, List[str]] = {}
    current = None
    for line in md_text.splitlines():
        heading = re.match(r"^#{1,6}\\s+(.*)", line)
        if heading:
            label = heading.group(1).strip().lower()
            key = None
            for candidate in SECTIONS_ORDER:
                if candidate in label:
                    key = candidate
                    break
            current = key
            continue
        if current:
            sections.setdefault(current, []).append(line)
    return {k: "\\n".join(v).strip() for k, v in sections.items()}


def pick_first_sentences(text: str, max_sentences: int = 2) -> str:
    sentences = re.split(r"(?<=[.!?])\\s+", text.strip())
    return " ".join(sentences[:max_sentences]).strip()


def to_bullets(text: str, limit: int = 5) -> List[str]:
    bullets = []
    for line in text.splitlines():
        clean = line.strip("-*• ").strip()
        if clean:
            bullets.append(clean)
        if len(bullets) >= limit:
            break
    return bullets


def build_slide(title: str, body: str, bullet_cap: int = 5) -> Dict:
    bullets = to_bullets(body, bullet_cap)
    if not bullets and body:
        bullets = [pick_first_sentences(body, 2)]
    return {"title": title, "bullets": bullets}


def build_plan(md_path: Path, diagram: str = None) -> Dict:
    raw = md_path.read_text(encoding="utf-8")
    sections = parse_markdown_sections(raw)

    slides = []
    narration = []

    def add(title: str, key: str, default: str = ""):
        content = sections.get(key, default)
        if not content:
            return
        slides.append(build_slide(title, content))
        narration.append(f"{title}: {pick_first_sentences(content, 3)}")

    add("What this repo is", "overview")
    add("Architecture", "architecture")
    add("How to run/deploy", "deployment")
    add("Cost overview", "cost")
    add("Security posture", "security")
    add("Troubleshooting", "troubleshooting")
    add("Customization", "customization")

    if not slides:
        slides.append(
            {
                "title": "Repository Overview",
                "bullets": [
                    "driftbox.md was found but no recognizable sections were parsed."
                ],
            }
        )
        narration.append("Repository overview. No detailed sections were found.")

    plan = {
        "source": str(md_path),
        "diagram": diagram,
        "slides": slides,
        "narration": narration,
        "notes": {
            "tts": "Run your preferred TTS on each narration entry to produce audio segments.",
            "render": "Stitch slides + audio with ffmpeg or a tool like Remotion. This script does not render video.",
        },
    }
    return plan


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=".", help="Path to the repo workspace")
    parser.add_argument(
        "--driftbox",
        default="driftbox.md",
        help="Path to driftbox.md (default: repo/driftbox.md)",
    )
    parser.add_argument("--diagram", default=None, help="Optional diagram image path")
    parser.add_argument(
        "--output", default="video_plan.json", help="Where to write the plan JSON"
    )
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    md_path = (repo / args.driftbox).resolve()
    if not md_path.exists():
        raise SystemExit(f"driftbox.md not found at {md_path}")

    plan = build_plan(md_path, diagram=args.diagram)
    Path(args.output).write_text(json.dumps(plan, indent=2), encoding="utf-8")
    print(f"Wrote plan to {args.output}")


if __name__ == "__main__":
    main()

